export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { uploadBufferToS3, getFileUrl } from '@/lib/s3';
import { processIncomingMessage } from '@/lib/order-intake';
import { logAuditAsync } from '@/lib/audit';
import { maskPhoneForLog } from '@/lib/phone';
import { whatsappInboundEnabled, getAppEnv } from '@/lib/env';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

// ─── Deduplication guard for Twilio retries ───
// Twilio retries webhooks if it doesn't get a response within ~15s.
// Track recently-seen MessageSid values to prevent duplicate processing.
const recentMessageSids = new Map<string, number>(); // SID → timestamp
const DEDUP_WINDOW_MS = 120_000; // 2 minutes

function isDuplicateMessage(sid: string): boolean {
  if (!sid) return false;
  const now = Date.now();
  // Clean old entries periodically
  if (recentMessageSids.size > 500) {
    for (const [k, ts] of recentMessageSids) {
      if (now - ts > DEDUP_WINDOW_MS) recentMessageSids.delete(k);
    }
  }
  if (recentMessageSids.has(sid)) {
    console.log(`[WhatsApp] ⚠️ Duplicate MessageSid detected: ${sid} — skipping retry`);
    return true;
  }
  recentMessageSids.set(sid, now);
  return false;
}

// GET: Health check
export async function GET() {
  return NextResponse.json({ status: 'WhatsApp Twilio webhook active' });
}

// POST: Incoming Twilio WhatsApp messages
export async function POST(request: Request) {
  try {
    // Twilio sends form-encoded data
    const formData = await request.formData();
    const body: Record<string, string> = {};
    formData.forEach((value, key) => {
      body[key] = value.toString();
    });

    const messageSid = body.MessageSid || body.SmsSid || '';
    console.log(`[WhatsApp] Webhook received: SID=${messageSid} Body=${(body.Body || '').length}chars NumMedia=${body.NumMedia || '0'}`);

    // Phase 2 — env-based WhatsApp inbound guard.
    // Default (no flag) returns true → identical Production behaviour.
    // Operators can disable per-env with WHATSAPP_INBOUND_ENABLED=false
    // to prevent Staging/Dev from accidentally processing Twilio traffic
    // if the sandbox webhook URL is ever misrouted.
    if (!whatsappInboundEnabled()) {
      console.log(`[WhatsApp] inbound guard: ignoring webhook in env=${getAppEnv()} (WHATSAPP_INBOUND_ENABLED=false)`);
      logAuditAsync({
        action: 'WHATSAPP_INBOUND_SKIPPED_BY_ENV',
        area: 'WEBHOOK',
        details: { env: getAppEnv(), sid: messageSid || null },
        request,
      });
      // Reply with a benign empty TwiML response so Twilio doesn't retry.
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // ─── Deduplication: skip Twilio retries ───
    if (isDuplicateMessage(messageSid)) {
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    const from = body.From || ''; // e.g. "whatsapp:+41791234567"
    const messageBody = body.Body || '';
    const numMedia = parseInt(body.NumMedia || '0', 10);
    const profileName = body.ProfileName || 'Unbekannt';

    // Extract phone number from "whatsapp:+41791234567"
    const phoneNumber = from.replace('whatsapp:', '');

    // Log incoming message
    logAuditAsync({
      action: 'WHATSAPP_MESSAGE_RECEIVED',
      area: 'WEBHOOK',
      details: { sender: profileName, phone: maskPhoneForLog(phoneNumber), hasMedia: numMedia > 0, hasText: !!messageBody.trim() },
    });

    let messageText = messageBody;
    let hasAudio = false;
    let audioSavedPath: string | null = null;
    let audioTranscriptText: string | null = null;
    // ─── Stage H: voice-message duration cap (60 s) — FAIL-SAFE ───
    // `voiceTooLong`     : duration is reliably known to be > 60 s.
    // `voiceUncheckable` : duration could NOT be determined safely (parser failed
    //                       AND ffprobe-via-FFmpeg fallback failed).
    //                       In this case we MUST NOT transcribe — cost protection
    //                       is the whole point. We create a manual review order
    //                       instead, with a different warning message.
    // `voiceDurationKnown` is true ONLY when we have a numeric duration we trust.
    let voiceTooLong = false;
    let voiceUncheckable = false;
    let voiceDurationSec: number | null = null;
    let voiceDurationKnown = false;
    // If the FFmpeg fallback already produced an MP3 (during the duration probe)
    // and the duration came back ≤60 s, we reuse that MP3 buffer for transcription
    // to avoid running FFmpeg twice on the same audio.
    let preconvertedMp3Buffer: Buffer | null = null;
    // ─── Stage K: server-side audio-quota enforcement ───
    // If the user's monthly transcription quota (Standard plan = 20 min) is
    // exhausted, OR if quota lookup fails (fail-safe), we MUST NOT transcribe.
    // We still save the audio + create a manual-review order with a clear warning.
    let voiceQuotaExceeded = false;
    let voiceQuotaUsedMinutes: number | null = null;
    let voiceQuotaIncludedMinutes: number | null = null;

    // Collected image data
    const collectedImages: { base64: string; mimeType: string; s3Path: string; previewPath: string; thumbPath: string }[] = [];

    // ─── Resolve userId BEFORE media processing ───
    // The audio-quota gate (Stage K) must run BEFORE we transcribe. Resolving
    // userId up front also avoids wasted media downloads / transcription cost
    // for messages from unmapped phone numbers.
    const { resolveUserIdByPhone } = await import('@/lib/phone-resolver');
    const resolvedUserId = await resolveUserIdByPhone(phoneNumber);
    if (!resolvedUserId) {
      console.warn(`[WhatsApp] ❌ No account found for phone ${maskPhoneForLog(phoneNumber)}`);
      logAuditAsync({ action: 'PHONE_MAPPING_FAILED', area: 'WEBHOOK', success: false, details: { phone: maskPhoneForLog(phoneNumber), sender: profileName } });
      return new Response('<Response><Message>⚠️ Diese Nummer ist keinem Account zugeordnet.</Message></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }
    logAuditAsync({ userId: resolvedUserId, action: 'PHONE_MAPPING_SUCCESS', area: 'WEBHOOK', details: { phone: maskPhoneForLog(phoneNumber), sender: profileName } });

    // Process media attachments — download + upload to S3, collect data
    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = body[`MediaUrl${i}`];
      const mediaContentType = body[`MediaContentType${i}`] || '';

      if (!mediaUrl) continue;

      try {
        const mediaRes = await fetch(mediaUrl, {
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
          },
        });

        if (!mediaRes.ok) {
          console.error(`Failed to download Twilio media ${i}:`, await mediaRes.text());
          continue;
        }

        const arrayBuffer = await mediaRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (mediaContentType.startsWith('audio/')) {
          // Voice message — process immediately (no batching)
          hasAudio = true;
          const ext = mediaContentType.includes('ogg') ? 'ogg' : mediaContentType.includes('mp4') ? 'm4a' : 'mp3';
          audioSavedPath = await uploadBufferToS3(buffer, `whatsapp-voice-${Date.now()}.${ext}`, mediaContentType, false);
          console.log(`[WhatsApp] 🎙️ Audio MIME=${mediaContentType}, bytes=${buffer.length}, savedTo=${audioSavedPath}`);

          // ─── Stage H (FAIL-SAFE): detect duration BEFORE deciding to transcribe ───
          // The 60 s cost cap is the whole point of this branch. If we cannot
          // determine the duration safely, we MUST NOT silently transcribe —
          // we create a manual review order instead.
          //
          // Probe priority:
          //   1) music-metadata on the raw buffer (fast, in-process).
          //   2) music-metadata without mimeType hint (some Twilio containers
          //      include `; codecs=opus` parameters that confuse the parser).
          //   3) FFmpeg-API fallback: convert max 70 s to MP3, then read
          //      duration from the MP3 (always parseable). Output is ≥70 s
          //      iff the original was ≥70 s, so we treat that as too_long.
          //   4) If all three fail → mark as `voiceUncheckable` and create a
          //      review order (no transcription).
          try {
            const { parseBuffer } = await import('music-metadata');
            const meta = await parseBuffer(buffer, { mimeType: mediaContentType });
            const dur = meta?.format?.duration;
            if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
              voiceDurationSec = dur;
              voiceDurationKnown = true;
              console.log(`[WhatsApp] 🎙️ Duration probe (music-metadata, with mime): ${dur.toFixed(1)}s`);
            } else {
              console.warn(`[WhatsApp] ⚠️ Duration probe (music-metadata, with mime): no usable duration in metadata`);
            }
          } catch (durErr: any) {
            console.warn(`[WhatsApp] ⚠️ Duration probe (music-metadata, with mime) failed: ${durErr?.message || durErr}`);
          }

          // Retry music-metadata WITHOUT a mime hint, in case Twilio's
          // Content-Type carried codec parameters that confused the parser.
          if (!voiceDurationKnown) {
            try {
              const { parseBuffer } = await import('music-metadata');
              const meta = await parseBuffer(buffer);
              const dur = meta?.format?.duration;
              if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
                voiceDurationSec = dur;
                voiceDurationKnown = true;
                console.log(`[WhatsApp] 🎙️ Duration probe (music-metadata, no mime hint): ${dur.toFixed(1)}s`);
              } else {
                console.warn(`[WhatsApp] ⚠️ Duration probe (music-metadata, no mime hint): no usable duration`);
              }
            } catch (durErr: any) {
              console.warn(`[WhatsApp] ⚠️ Duration probe (music-metadata, no mime hint) failed: ${durErr?.message || durErr}`);
            }
          }

          // FFmpeg-API fallback: convert max 70 s to MP3 + read duration.
          // - If the converted MP3 is ≥ 70 s (clamped), the original was at
          //   least 70 s ⇒ too_long.
          // - Otherwise the MP3 duration IS the original duration.
          // - The resulting MP3 buffer is reused for transcription if ≤60 s,
          //   so we don't run FFmpeg twice.
          let probeClamped = false;
          if (!voiceDurationKnown) {
            try {
              const signedUrl = await getFileUrl(audioSavedPath, false);
              console.log(`[WhatsApp] 🎙️ Duration probe (FFmpeg fallback): starting (cap=70s)…`);
              const probe = await probeDurationViaFfmpegConvert(signedUrl);
              if (probe.durationSec !== null && isFinite(probe.durationSec) && probe.durationSec > 0) {
                voiceDurationSec = probe.durationSec;
                voiceDurationKnown = true;
                probeClamped = probe.clamped;
                if (probe.mp3Buffer) preconvertedMp3Buffer = probe.mp3Buffer;
                console.log(`[WhatsApp] 🎙️ Duration probe (FFmpeg fallback): ${probe.durationSec.toFixed(1)}s, clamped=${probeClamped}, mp3Buffer=${preconvertedMp3Buffer ? preconvertedMp3Buffer.length + 'B' : 'none'}`);
              } else {
                console.warn(`[WhatsApp] ⚠️ Duration probe (FFmpeg fallback): no usable duration from MP3 output`);
              }
            } catch (probeErr: any) {
              console.warn(`[WhatsApp] ⚠️ Duration probe (FFmpeg fallback) threw: ${probeErr?.message || probeErr}`);
            }
          }

          // ─── Decision matrix ───
          if (voiceDurationKnown && voiceDurationSec !== null && (probeClamped || voiceDurationSec > 60)) {
            // Reliably known to be too long.
            voiceTooLong = true;
            // Discard preconverted MP3 — we will NOT transcribe.
            preconvertedMp3Buffer = null;
            console.log(`[WhatsApp] ⏱️ Decision: SKIPPED (>60s, duration=${voiceDurationSec.toFixed(1)}s${probeClamped ? ', clamped' : ''}). No transcription, no LLM. Review order will be created.`);
            logAuditAsync({
              action: 'MEDIA_RECEIVED',
              area: 'WEBHOOK',
              details: {
                type: 'audio',
                sender: profileName,
                phone: maskPhoneForLog(phoneNumber),
                audioBytes: buffer.length,
                audioDurationSec: Math.round(voiceDurationSec),
                durationClamped: probeClamped,
                transcriptionSkipped: true,
                reason: 'voice_too_long',
              },
            });
          } else if (!voiceDurationKnown) {
            // All three probes failed — duration cannot be determined safely.
            // Cost protection demands we DO NOT transcribe in this case.
            voiceUncheckable = true;
            preconvertedMp3Buffer = null;
            console.warn(`[WhatsApp] ⏱️ Decision: REVIEW (UNCHECKABLE — all duration probes failed). No transcription, no LLM. Review order will be created.`);
            logAuditAsync({
              action: 'MEDIA_RECEIVED',
              area: 'WEBHOOK',
              details: {
                type: 'audio',
                sender: profileName,
                phone: maskPhoneForLog(phoneNumber),
                audioBytes: buffer.length,
                audioDurationSec: null,
                transcriptionSkipped: true,
                reason: 'voice_uncheckable',
              },
            });
          } else {
            // Within cap and duration known: check monthly quota BEFORE transcribing.
            // ─── Stage K: server-side audio-quota gate ───
            // The user has a monthly transcription budget (Standard plan = 20 min).
            // If exhausted (or quota lookup fails — fail-safe), we MUST NOT
            // transcribe. We still save the audio + create a manual-review order
            // with a clear warning further down via createVoiceTooLongReviewOrder.
            const { checkAudioTranscriptionQuota } = await import('@/lib/audio-quota');
            const quota = await checkAudioTranscriptionQuota(resolvedUserId, voiceDurationSec);
            if (!quota.allowTranscription) {
              voiceQuotaExceeded = true;
              voiceQuotaUsedMinutes = quota.usedMinutes;
              voiceQuotaIncludedMinutes = quota.includedMinutes;
              preconvertedMp3Buffer = null;
              console.warn(`[WhatsApp] 🛑 Decision: REVIEW (QUOTA EXCEEDED — used=${quota.usedMinutes}/${quota.includedMinutes}min, reason=${quota.reason}, duration=${voiceDurationSec!.toFixed(1)}s). No transcription, no LLM. Review order will be created.`);
              logAuditAsync({
                userId: resolvedUserId,
                action: 'MEDIA_RECEIVED',
                area: 'WEBHOOK',
                details: {
                  type: 'audio',
                  sender: profileName,
                  phone: maskPhoneForLog(phoneNumber),
                  audioBytes: buffer.length,
                  audioDurationSec: Math.round(voiceDurationSec!),
                  durationKnown: true,
                  transcriptionSkipped: true,
                  reason: 'voice_quota_exceeded',
                  quotaUsedMinutes: quota.usedMinutes,
                  quotaIncludedMinutes: quota.includedMinutes,
                  quotaCheckReason: quota.reason,
                },
              });
            } else {
              // Within cap, duration known, quota OK: proceed with normal transcription pipeline.
              console.log(`[WhatsApp] ⏱️ Decision: TRANSCRIBE (≤60s, duration=${voiceDurationSec!.toFixed(1)}s, quota: used=${quota.usedMinutes}/${quota.includedMinutes}min). preconvertedMp3=${preconvertedMp3Buffer ? 'yes' : 'no'}`);
              logAuditAsync({
                action: 'MEDIA_RECEIVED',
                area: 'WEBHOOK',
                details: {
                  type: 'audio',
                  sender: profileName,
                  phone: maskPhoneForLog(phoneNumber),
                  audioBytes: buffer.length,
                  audioDurationSec: Math.round(voiceDurationSec!),
                  durationKnown: true,
                  transcriptionSkipped: false,
                  quotaUsedMinutes: quota.usedMinutes,
                  quotaIncludedMinutes: quota.includedMinutes,
                },
              });

              let mp3Buffer: Buffer | null = preconvertedMp3Buffer;
              if (!mp3Buffer) {
                if (mediaContentType.includes('ogg') || mediaContentType.includes('opus')) {
                  const signedUrl = await getFileUrl(audioSavedPath, false);
                  mp3Buffer = await convertToMp3ViaFfmpeg(signedUrl);
                } else if (mediaContentType.includes('mp3') || mediaContentType.includes('wav')) {
                  mp3Buffer = buffer;
                } else {
                  const signedUrl = await getFileUrl(audioSavedPath, false);
                  mp3Buffer = await convertToMp3ViaFfmpeg(signedUrl);
                }
              }

              if (mp3Buffer) {
                const transcription = await transcribeAudio(mp3Buffer);
                if (transcription) {
                  audioTranscriptText = `[Transkription]: ${transcription}`;
                }
              }
            }
          }
        } else if (mediaContentType.startsWith('image/')) {
          const ext = mediaContentType.includes('png') ? 'png' : 'jpg';
          const s3Path = await uploadBufferToS3(buffer, `whatsapp-photo-${Date.now()}-${i}.${ext}`, mediaContentType, false);
          console.log(`WhatsApp image saved to S3 (original archive): ${s3Path}`);
          logAuditAsync({
            action: 'MEDIA_RECEIVED',
            area: 'WEBHOOK',
            details: {
              type: 'image',
              index: i,
              sender: profileName,
              phone: maskPhoneForLog(phoneNumber),
              originalBytes: buffer.length,
            },
          });

          // ─── COST OPTIMIZATION (Stage H) ───
          // Use the optimized WebP preview buffer for AI vision instead of
          // the original. Original bytes remain in S3 (s3Path) for archive.
          let previewPath = s3Path;
          let thumbPath = s3Path;
          let aiBase64 = buffer.toString('base64'); // fallback: original
          let aiMimeType = mediaContentType;
          let optimizedSentToAi = false;
          let aiBytes = buffer.length;
          try {
            const { optimizeImage } = await import('@/lib/image-optimizer');
            const optimized = await optimizeImage(buffer, `whatsapp-photo-${Date.now()}-${i}`, mediaContentType);
            if (optimized) {
              previewPath = optimized.previewPath;
              thumbPath = optimized.thumbnailPath;
              // Use the in-memory WebP preview buffer for the LLM payload.
              aiBase64 = optimized.previewBuffer.toString('base64');
              aiMimeType = 'image/webp';
              optimizedSentToAi = true;
              aiBytes = optimized.previewBytes;
              console.log(
                `[WhatsApp] 🖼️ Image ${i}: AI will receive optimized WebP preview ` +
                `(${(optimized.previewBytes / 1024).toFixed(0)}KB) instead of original ` +
                `(${(optimized.originalBytes / 1024).toFixed(0)}KB) — original kept in S3 archive.`
              );
            }
          } catch (optErr) {
            console.error('Image optimization error:', optErr);
          }
          if (!optimizedSentToAi) {
            console.warn(
              `[WhatsApp] ⚠️ Image ${i}: optimization failed — falling back to ` +
              `ORIGINAL bytes for AI (${(buffer.length / 1024).toFixed(0)}KB). ` +
              `Original is still archived in S3.`
            );
          }
          logAuditAsync({
            action: 'WHATSAPP_IMAGE_AI_PAYLOAD',
            area: 'WEBHOOK',
            details: {
              index: i,
              phone: maskPhoneForLog(phoneNumber),
              optimizedSentToAi,
              originalBytes: buffer.length,
              aiBytes,
            },
          });

          collectedImages.push({ base64: aiBase64, mimeType: aiMimeType, s3Path, previewPath, thumbPath });
        }
      } catch (err) {
        console.error(`Error processing media ${i}:`, err);
      }
    }

    // If no processable content at all, skip
    if (!messageText.trim() && collectedImages.length === 0 && !hasAudio) {
      console.log('No processable content, skipping');
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    console.log(`WhatsApp from ${profileName} (${maskPhoneForLog(phoneNumber)}): text="${messageText.slice(0, 80)}" images=${collectedImages.length} audio=${hasAudio}`);

    // userId already resolved before media loop (Stage K).
    // ─── Stage H: Long voice (>60s) short-circuit — bypass LLM, create review order ───
    if (voiceTooLong) {
      console.log(`[WhatsApp] ⏱️ Creating long-voice review order for ${maskPhoneForLog(phoneNumber)} (duration=${voiceDurationSec?.toFixed(1)}s, images=${collectedImages.length})`);

      const imagePreviewPaths = collectedImages.map(c => c.previewPath).filter(Boolean);
      const imageThumbnailPaths = collectedImages.map(c => c.thumbPath).filter(Boolean);

      const { createVoiceTooLongReviewOrder } = await import('@/lib/order-intake');
      createVoiceTooLongReviewOrder({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        audioPath: audioSavedPath,
        durationSec: voiceDurationSec,
        userId: resolvedUserId,
        imagePreviewPaths,
        imageThumbnailPaths,
        reason: 'too_long',
      }).then(result => {
        if (result) {
          console.log(`[WhatsApp] ✅ Long-voice review order created: ${result.orderId}`);
        } else {
          console.warn(`[WhatsApp] ⚠️ Long-voice review order creation returned null for ${maskPhoneForLog(phoneNumber)}`);
        }
      }).catch(err => {
        console.error(`[WhatsApp] ❌ Long-voice review order creation failed for ${maskPhoneForLog(phoneNumber)}:`, err);
      });

      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // ─── Stage H.2 (FAIL-SAFE): Uncheckable voice short-circuit — bypass LLM, create review order ───
    // We get here ONLY when every duration probe failed. The cost cap is the whole
    // point of Stage H, so we MUST NOT silently transcribe.
    if (voiceUncheckable) {
      console.log(`[WhatsApp] ⏱️ Creating UNCHECKABLE-voice review order for ${maskPhoneForLog(phoneNumber)} (duration=unknown, images=${collectedImages.length})`);

      const imagePreviewPaths = collectedImages.map(c => c.previewPath).filter(Boolean);
      const imageThumbnailPaths = collectedImages.map(c => c.thumbPath).filter(Boolean);

      const { createVoiceTooLongReviewOrder } = await import('@/lib/order-intake');
      createVoiceTooLongReviewOrder({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        audioPath: audioSavedPath,
        durationSec: null,
        userId: resolvedUserId,
        imagePreviewPaths,
        imageThumbnailPaths,
        reason: 'uncheckable',
      }).then(result => {
        if (result) {
          console.log(`[WhatsApp] ✅ Uncheckable-voice review order created: ${result.orderId}`);
        } else {
          console.warn(`[WhatsApp] ⚠️ Uncheckable-voice review order creation returned null for ${maskPhoneForLog(phoneNumber)}`);
        }
      }).catch(err => {
        console.error(`[WhatsApp] ❌ Uncheckable-voice review order creation failed for ${maskPhoneForLog(phoneNumber)}:`, err);
      });

      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // ─── Stage K (FAIL-SAFE): Quota-exceeded voice short-circuit — bypass LLM, create review order ───
    // We get here when the user has hit the monthly transcription quota OR the
    // quota lookup failed (fail-safe). In both cases we MUST NOT transcribe —
    // we save the audio and create a manual-review order with a warning.
    if (voiceQuotaExceeded) {
      console.log(`[WhatsApp] 🛑 Creating QUOTA-EXCEEDED voice review order for ${maskPhoneForLog(phoneNumber)} (used=${voiceQuotaUsedMinutes}/${voiceQuotaIncludedMinutes}min, duration=${voiceDurationSec?.toFixed(1)}s, images=${collectedImages.length})`);

      const imagePreviewPaths = collectedImages.map(c => c.previewPath).filter(Boolean);
      const imageThumbnailPaths = collectedImages.map(c => c.thumbPath).filter(Boolean);

      const { createVoiceTooLongReviewOrder } = await import('@/lib/order-intake');
      createVoiceTooLongReviewOrder({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        audioPath: audioSavedPath,
        durationSec: voiceDurationSec,
        userId: resolvedUserId,
        imagePreviewPaths,
        imageThumbnailPaths,
        reason: 'quota_exceeded',
        quotaUsedMinutes: voiceQuotaUsedMinutes ?? undefined,
        quotaIncludedMinutes: voiceQuotaIncludedMinutes ?? undefined,
      }).then(result => {
        if (result) {
          console.log(`[WhatsApp] ✅ Quota-exceeded voice review order created: ${result.orderId}`);
        } else {
          console.warn(`[WhatsApp] ⚠️ Quota-exceeded voice review order creation returned null for ${maskPhoneForLog(phoneNumber)}`);
        }
      }).catch(err => {
        console.error(`[WhatsApp] ❌ Quota-exceeded voice review order creation failed for ${maskPhoneForLog(phoneNumber)}:`, err);
      });

      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // ─── Stage I — derive audioTranscriptionStatus for the ≤60 s path ───
    // Long-voice (>60 s) and uncheckable are already handled above via
    // createVoiceTooLongReviewOrder which writes the right status itself. Here
    // we only derive the status for the normal pipeline: 'transcribed' if
    // Whisper produced text, else 'failed' (FFmpeg or Whisper hiccup, but still
    // a real audio message that hit our system).
    const audioTranscriptionStatusForIntake: 'transcribed' | 'failed' | null = hasAudio
      ? (audioTranscriptText ? 'transcribed' : 'failed')
      : null;
    const audioDurationSecForIntake: number | null = hasAudio
      ? (voiceDurationKnown && voiceDurationSec !== null ? voiceDurationSec : null)
      : null;

    // ─── Batching logic ───
    // Audio-only messages: fire-and-forget (return immediately to avoid Twilio timeout)
    if (hasAudio && collectedImages.length === 0) {
      let finalText = messageText;
      if (audioTranscriptText) finalText = finalText ? `${finalText}\n\n${audioTranscriptText}` : audioTranscriptText;

      console.log(`[WhatsApp] 🎙️ Audio-only message from ${maskPhoneForLog(phoneNumber)} (text=${finalText.length}chars, durationSec=${audioDurationSecForIntake ?? '?'}, status=${audioTranscriptionStatusForIntake}) — processing async`);

      processIncomingMessage({
        source: 'WhatsApp', senderName: profileName, messageText: finalText,
        phoneNumber,
        imageBase64: null, imageMimeType: 'image/jpeg',
        savedMediaPath: audioSavedPath, savedMediaType: 'audio',
        optimizedPreviewPath: null, optimizedThumbnailPath: null,
        userId: resolvedUserId,
        audioDurationSec: audioDurationSecForIntake,
        audioTranscriptionStatus: audioTranscriptionStatusForIntake,
      }).then(orderCreated => {
        if (orderCreated) {
          console.log(`[WhatsApp] ✅ Audio order created: ${orderCreated.description}`);
        } else {
          console.log(`[WhatsApp] ⚠️ Audio processing returned no order for ${maskPhoneForLog(phoneNumber)}`);
        }
      }).catch(err => {
        console.error(`[WhatsApp] ❌ Audio processing failed for ${maskPhoneForLog(phoneNumber)}:`, err);
      });

      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // Text-only messages (no images, no audio): fire-and-forget (return immediately to avoid Twilio timeout)
    if (collectedImages.length === 0 && !hasAudio) {
      console.log(`[WhatsApp] 📝 Text-only message from ${maskPhoneForLog(phoneNumber)} (${messageText.length}chars) — processing async`);

      processIncomingMessage({
        source: 'WhatsApp', senderName: profileName, messageText,
        phoneNumber,
        imageBase64: null, imageMimeType: 'image/jpeg',
        savedMediaPath: null, savedMediaType: null,
        optimizedPreviewPath: null, optimizedThumbnailPath: null,
        userId: resolvedUserId,
      }).then(orderCreated => {
        if (orderCreated) {
          console.log(`[WhatsApp] ✅ Text order created: ${orderCreated.description} (${messageText.length}chars input)`);
        } else {
          console.log(`[WhatsApp] ⚠️ Text processing returned no order for ${maskPhoneForLog(phoneNumber)}`);
        }
      }).catch(err => {
        console.error(`[WhatsApp] ❌ Text processing failed for ${maskPhoneForLog(phoneNumber)} (${messageText.length}chars):`, err);
      });

      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // ─── Image message → process per-webhook (1 webhook = 1 order) ───
    // CRITICAL SAFETY: Each Twilio webhook has a unique MessageSid.
    // One WhatsApp message (even with multiple images) = one webhook = one order.
    // Separate forwarded messages = separate webhooks = separate orders.
    // NO cross-message batching — never merge different messages.
    let finalText = messageText;
    if (audioTranscriptText) finalText = finalText ? `${finalText}\n\n${audioTranscriptText}` : audioTranscriptText;

    const hasImages = collectedImages.length > 0;
    console.log(`[WhatsApp] 🖼️ Image message from ${maskPhoneForLog(phoneNumber)} (SID=${messageSid}, ${collectedImages.length} images, text=${finalText.length}chars) — processing async`);

    processIncomingMessage({
      source: 'WhatsApp',
      senderName: profileName,
      phoneNumber,
      messageText: finalText,
      imageBase64: hasImages ? collectedImages[0].base64 : null,
      imageMimeType: hasImages ? collectedImages[0].mimeType : 'image/jpeg',
      savedMediaPath: audioSavedPath || (hasImages ? collectedImages[0].s3Path : null),
      savedMediaType: audioSavedPath ? 'audio' : (hasImages ? 'image' : null),
      optimizedPreviewPath: hasImages ? collectedImages[0].previewPath : null,
      optimizedThumbnailPath: hasImages ? collectedImages[0].thumbPath : null,
      userId: resolvedUserId,
      allImageBase64s: hasImages ? collectedImages.map(i => i.base64) : undefined,
      allImageMimeTypes: hasImages ? collectedImages.map(i => i.mimeType) : undefined,
      allSavedMediaPaths: hasImages ? collectedImages.map(i => i.s3Path) : undefined,
      allOptimizedPreviewPaths: hasImages ? collectedImages.map(i => i.previewPath) : undefined,
      allOptimizedThumbnailPaths: hasImages ? collectedImages.map(i => i.thumbPath) : undefined,
      // Stage I — pass audio metadata when this mixed message also carries audio (rare, but possible)
      audioDurationSec: audioDurationSecForIntake,
      audioTranscriptionStatus: audioTranscriptionStatusForIntake,
    }).then(orderCreated => {
      if (orderCreated) {
        console.log(`[WhatsApp] ✅ Image order created: ${orderCreated.description} (SID=${messageSid}, ${collectedImages.length} images)`);
      }
    }).catch(err => {
      console.error(`[WhatsApp] ❌ Image processing failed (SID=${messageSid}):`, err);
    });

    return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
  } catch (error: any) {
    console.error('Twilio WhatsApp webhook error:', error);
    logAuditAsync({ action: 'WHATSAPP_WEBHOOK_ERROR', area: 'WEBHOOK', success: false, details: { error: error?.message || 'Unknown error' } });
    return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Convert audio to MP3 using FFmpeg API
async function convertToMp3ViaFfmpeg(audioUrl: string): Promise<Buffer | null> {
  try {
    console.log('FFmpeg: Converting audio to MP3...');
    const createResponse = await fetch('https://apps.abacus.ai/api/createRunFfmpegCommandRequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        input_files: { in_1: audioUrl },
        output_files: { out_1: 'audio.mp3' },
        ffmpeg_command: '-i {{in_1}} -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k {{out_1}}',
      }),
    });

    if (!createResponse.ok) {
      console.error('FFmpeg create error:', await createResponse.text());
      return null;
    }

    const { request_id } = await createResponse.json();
    if (!request_id) return null;

    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const statusRes = await fetch('https://apps.abacus.ai/api/getRunFfmpegCommandStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id, deployment_token: process.env.ABACUSAI_API_KEY }),
      });
      const statusResult = await statusRes.json();
      if (statusResult?.status === 'SUCCESS' && statusResult?.result?.result?.out_1) {
        const mp3Res = await fetch(statusResult.result.result.out_1);
        if (mp3Res.ok) return Buffer.from(await mp3Res.arrayBuffer());
        return null;
      } else if (statusResult?.status === 'FAILED') {
        console.error('FFmpeg failed:', statusResult?.result?.error);
        return null;
      }
    }
    return null;
  } catch (err) {
    console.error('FFmpeg error:', err);
    return null;
  }
}

/**
 * Stage H.2 — FAIL-SAFE duration probe via FFmpeg.
 *
 * Used as a fallback when music-metadata cannot determine the duration.
 *
 * Strategy: convert AT MOST 70 seconds of audio to MP3. The MP3 container
 * is reliably parseable by music-metadata, so we then read the duration
 * from the MP3 buffer.
 *
 *  - If the MP3 duration is ≥ ~70 s, the original was at least 70 s ⇒ too long
 *    for the 60 s cap. Caller should treat as `clamped: true`.
 *  - If the MP3 duration is < 70 s, that IS the original duration.
 *  - The returned MP3 buffer (when duration ≤ 60 s) is reused for transcription
 *    so we don't run FFmpeg twice on the same audio.
 *
 * Returns `{ durationSec: null }` if the FFmpeg API call fails or the resulting
 * MP3 cannot be parsed. The caller will then mark the message as
 * `voiceUncheckable` (NOT silently transcribed).
 */
async function probeDurationViaFfmpegConvert(
  audioUrl: string,
): Promise<{ durationSec: number | null; mp3Buffer: Buffer | null; clamped: boolean }> {
  try {
    const createResponse = await fetch('https://apps.abacus.ai/api/createRunFfmpegCommandRequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        input_files: { in_1: audioUrl },
        output_files: { out_1: 'audio.mp3' },
        // -t 70 hard-clamps the output to at most 70 s of audio. We keep the
        // bitrate low because we only need the MP3 for duration probing AND
        // (potentially) for transcription of ≤60 s clips.
        ffmpeg_command: '-i {{in_1}} -t 70 -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k {{out_1}}',
      }),
    });
    if (!createResponse.ok) {
      console.error('[WhatsApp] FFmpeg probe create error:', await createResponse.text());
      return { durationSec: null, mp3Buffer: null, clamped: false };
    }
    const createJson = await createResponse.json();
    const request_id = createJson?.request_id;
    if (!request_id) return { durationSec: null, mp3Buffer: null, clamped: false };

    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const statusRes = await fetch('https://apps.abacus.ai/api/getRunFfmpegCommandStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id, deployment_token: process.env.ABACUSAI_API_KEY }),
      });
      const statusResult = await statusRes.json();
      if (statusResult?.status === 'SUCCESS' && statusResult?.result?.result?.out_1) {
        const mp3Res = await fetch(statusResult.result.result.out_1);
        if (!mp3Res.ok) return { durationSec: null, mp3Buffer: null, clamped: false };
        const mp3Buffer = Buffer.from(await mp3Res.arrayBuffer());
        try {
          const { parseBuffer } = await import('music-metadata');
          const meta = await parseBuffer(mp3Buffer, { mimeType: 'audio/mpeg' });
          const dur = meta?.format?.duration;
          if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
            // Treat ≥69.5s as "clamped" — we asked for 70s max, so anything
            // close to that means the original was at least 70 s long.
            const clamped = dur >= 69.5;
            return { durationSec: dur, mp3Buffer, clamped };
          }
        } catch (parseErr: any) {
          console.warn('[WhatsApp] FFmpeg probe: MP3 metadata parse failed:', parseErr?.message || parseErr);
        }
        // FFmpeg succeeded but we couldn't parse the MP3 → no duration.
        // Still return the MP3 buffer (caller might decide to discard it).
        return { durationSec: null, mp3Buffer, clamped: false };
      } else if (statusResult?.status === 'FAILED') {
        console.error('[WhatsApp] FFmpeg probe failed:', statusResult?.result?.error);
        return { durationSec: null, mp3Buffer: null, clamped: false };
      }
    }
    return { durationSec: null, mp3Buffer: null, clamped: false };
  } catch (err: any) {
    console.error('[WhatsApp] FFmpeg probe error:', err?.message || err);
    return { durationSec: null, mp3Buffer: null, clamped: false };
  }
}

// Transcribe audio using LLM
async function transcribeAudio(mp3Buffer: Buffer): Promise<string | null> {
  try {
    const response = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ABACUSAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-audio-preview-2025-06-03',
        messages: [
          { role: 'system', content: 'Transkribiere die folgende Sprachnachricht auf Deutsch. Gib nur den transkribierten Text zurück, ohne Anführungszeichen oder Erklärungen. Auch Schweizerdeutsch/Dialekt soll auf Hochdeutsch transkribiert werden.' },
          { role: 'user', content: [{ type: 'input_audio', input_audio: { data: mp3Buffer.toString('base64'), format: 'mp3' } }] },
        ],
        max_tokens: 2000,
      }),
    });
    if (!response.ok) {
      console.error('Transcription error:', await response.text());
      return null;
    }
    const result = await response.json();
    return result?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.error('Transcription error:', err);
    return null;
  }
}