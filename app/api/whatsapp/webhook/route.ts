export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { uploadBufferToS3 } from '@/lib/s3';
import { processIncomingMessage } from '@/lib/order-intake';
import { logAuditAsync } from '@/lib/audit';
import { maskPhoneForLog } from '@/lib/phone';
import { whatsappInboundEnabled, getAppEnv } from '@/lib/env';
import { probeAudioDuration, convertAudioToCompactMp3 } from '@/lib/audio-convert';

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

// ─────────────────────────────────────────────────────────────────────────────
// Background async audio processing — runs AFTER TwiML response is sent.
//
// Phase 3 refactor: the POST handler returns immediately to Twilio (<200ms).
// All heavy audio work (duration probe, compression, quota check, transcription,
// order creation) happens here, outside the request/response cycle.
// ─────────────────────────────────────────────────────────────────────────────
async function processWhatsAppMediaAsync(params: {
  audioBuffer: Buffer;
  audioSavedPath: string;
  mediaContentType: string;
  phoneNumber: string;
  profileName: string;
  resolvedUserId: string;
  messageText: string;
  collectedImages: { base64: string; mimeType: string; s3Path: string; previewPath: string; thumbPath: string }[];
}): Promise<void> {
  const {
    audioBuffer,
    audioSavedPath,
    mediaContentType,
    phoneNumber,
    profileName,
    resolvedUserId,
    messageText,
    collectedImages,
  } = params;

  const originalKB = (audioBuffer.length / 1024).toFixed(0);

  try {
    // ─── Step 1: Duration probe via local FFmpeg ───
    const durationSec = await probeAudioDuration(audioBuffer);

    // ─── Step 2: Compress to compact MP3 ───
    const compressedBuffer = await convertAudioToCompactMp3(audioBuffer);
    const compressedKB = compressedBuffer ? (compressedBuffer.length / 1024).toFixed(0) : '--';

    // ─── Step 3: Decision matrix ───
    // duration === null → unknown → review order
    // duration > 60    → too long → review order
    // duration <= 60   → compress → quota check → transcribe → order

    if (durationSec === null) {
      // UNCHECKABLE — all probes failed, cost protection: no transcription
      console.log(`[AUDIO] Original: ${originalKB}KB | Compressed: ${compressedKB} | Duration: unknown | Decision: duration_unknown`);

      logAuditAsync({
        action: 'MEDIA_RECEIVED',
        area: 'WEBHOOK',
        details: {
          type: 'audio',
          sender: profileName,
          phone: maskPhoneForLog(phoneNumber),
          audioBytes: audioBuffer.length,
          audioDurationSec: null,
          transcriptionSkipped: true,
          reason: 'voice_uncheckable',
        },
      });

      const imagePreviewPaths = collectedImages.map(c => c.previewPath).filter(Boolean);
      const imageThumbnailPaths = collectedImages.map(c => c.thumbPath).filter(Boolean);

      const { createVoiceTooLongReviewOrder } = await import('@/lib/order-intake');
      const result = await createVoiceTooLongReviewOrder({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        audioPath: audioSavedPath,
        durationSec: null,
        userId: resolvedUserId,
        imagePreviewPaths,
        imageThumbnailPaths,
        reason: 'uncheckable',
      });
      if (result) {
        console.log(`[WhatsApp] ✅ Uncheckable-voice review order created: ${result.orderId}`);
      } else {
        console.warn(`[WhatsApp] ⚠️ Uncheckable-voice review order returned null for ${maskPhoneForLog(phoneNumber)}`);
      }
      return;
    }

    if (durationSec > 60) {
      // TOO LONG — skip transcription, create review order
      console.log(`[AUDIO] Original: ${originalKB}KB | Compressed: ${compressedKB} | Duration: ${durationSec.toFixed(1)}s | Decision: too_long`);

      logAuditAsync({
        action: 'MEDIA_RECEIVED',
        area: 'WEBHOOK',
        details: {
          type: 'audio',
          sender: profileName,
          phone: maskPhoneForLog(phoneNumber),
          audioBytes: audioBuffer.length,
          audioDurationSec: Math.round(durationSec),
          transcriptionSkipped: true,
          reason: 'voice_too_long',
        },
      });

      const imagePreviewPaths = collectedImages.map(c => c.previewPath).filter(Boolean);
      const imageThumbnailPaths = collectedImages.map(c => c.thumbPath).filter(Boolean);

      const { createVoiceTooLongReviewOrder } = await import('@/lib/order-intake');
      const result = await createVoiceTooLongReviewOrder({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        audioPath: audioSavedPath,
        durationSec,
        userId: resolvedUserId,
        imagePreviewPaths,
        imageThumbnailPaths,
        reason: 'too_long',
      });
      if (result) {
        console.log(`[WhatsApp] ✅ Long-voice review order created: ${result.orderId}`);
      } else {
        console.warn(`[WhatsApp] ⚠️ Long-voice review order returned null for ${maskPhoneForLog(phoneNumber)}`);
      }
      return;
    }

    // ─── Duration ≤ 60s — check quota, then transcribe ───
    const { checkAudioTranscriptionQuota } = await import('@/lib/audio-quota');
    const quota = await checkAudioTranscriptionQuota(resolvedUserId, durationSec);

    if (!quota.allowTranscription) {
      // QUOTA EXCEEDED — skip transcription, create review order
      console.log(`[AUDIO] Original: ${originalKB}KB | Compressed: ${compressedKB} | Duration: ${durationSec.toFixed(1)}s | Decision: quota_exceeded (used=${quota.usedMinutes}/${quota.includedMinutes}min)`);

      logAuditAsync({
        userId: resolvedUserId,
        action: 'MEDIA_RECEIVED',
        area: 'WEBHOOK',
        details: {
          type: 'audio',
          sender: profileName,
          phone: maskPhoneForLog(phoneNumber),
          audioBytes: audioBuffer.length,
          audioDurationSec: Math.round(durationSec),
          transcriptionSkipped: true,
          reason: 'voice_quota_exceeded',
          quotaUsedMinutes: quota.usedMinutes,
          quotaIncludedMinutes: quota.includedMinutes,
          quotaCheckReason: quota.reason,
        },
      });

      const imagePreviewPaths = collectedImages.map(c => c.previewPath).filter(Boolean);
      const imageThumbnailPaths = collectedImages.map(c => c.thumbPath).filter(Boolean);

      const { createVoiceTooLongReviewOrder } = await import('@/lib/order-intake');
      const result = await createVoiceTooLongReviewOrder({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        audioPath: audioSavedPath,
        durationSec,
        userId: resolvedUserId,
        imagePreviewPaths,
        imageThumbnailPaths,
        reason: 'quota_exceeded',
        quotaUsedMinutes: quota.usedMinutes ?? undefined,
        quotaIncludedMinutes: quota.includedMinutes ?? undefined,
      });
      if (result) {
        console.log(`[WhatsApp] ✅ Quota-exceeded voice review order created: ${result.orderId}`);
      } else {
        console.warn(`[WhatsApp] ⚠️ Quota-exceeded voice review order returned null for ${maskPhoneForLog(phoneNumber)}`);
      }
      return;
    }

    // ─── Quota OK, duration ≤ 60s → transcribe ───
    const mp3Buffer = compressedBuffer ?? audioBuffer; // fallback to original if compression failed

    console.log(`[AUDIO] Original: ${originalKB}KB | Compressed: ${compressedKB} | Duration: ${durationSec.toFixed(1)}s | Decision: transcribed (quota: ${quota.usedMinutes}/${quota.includedMinutes}min)`);

    logAuditAsync({
      action: 'MEDIA_RECEIVED',
      area: 'WEBHOOK',
      details: {
        type: 'audio',
        sender: profileName,
        phone: maskPhoneForLog(phoneNumber),
        audioBytes: audioBuffer.length,
        audioDurationSec: Math.round(durationSec),
        transcriptionSkipped: false,
        quotaUsedMinutes: quota.usedMinutes,
        quotaIncludedMinutes: quota.includedMinutes,
      },
    });

    let audioTranscriptText: string | null = null;
    const transcription = await transcribeAudio(mp3Buffer);
    if (transcription) {
      audioTranscriptText = `[Transkription]: ${transcription}`;
    }

    const audioTranscriptionStatus: 'transcribed' | 'failed' = audioTranscriptText ? 'transcribed' : 'failed';

    // ─── Transcription failed → create review order as fallback ───
    if (audioTranscriptionStatus === 'failed') {
      console.warn(`[AUDIO] Transcription failed for ${maskPhoneForLog(phoneNumber)} — creating review order fallback`);

      const imagePreviewPaths = collectedImages.map(c => c.previewPath).filter(Boolean);
      const imageThumbnailPaths = collectedImages.map(c => c.thumbPath).filter(Boolean);

      const { createVoiceTooLongReviewOrder } = await import('@/lib/order-intake');
      const result = await createVoiceTooLongReviewOrder({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        audioPath: audioSavedPath,
        durationSec,
        userId: resolvedUserId,
        imagePreviewPaths,
        imageThumbnailPaths,
        reason: 'transcription_failed',
      });
      if (result) {
        console.log(`[WhatsApp] ✅ Transcription-failed review order created: ${result.orderId}`);
      } else {
        console.warn(`[WhatsApp] ⚠️ Transcription-failed review order returned null for ${maskPhoneForLog(phoneNumber)}`);
      }
      return;
    }

    // Build final text
    let finalText = messageText;
    if (audioTranscriptText) finalText = finalText ? `${finalText}\n\n${audioTranscriptText}` : audioTranscriptText;

    // If there are also images with this audio, include them
    const hasImages = collectedImages.length > 0;

    if (hasImages) {
      // Mixed message: audio + images — process as image order with audio metadata
      const orderResult = await processIncomingMessage({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        messageText: finalText,
        imageBase64: collectedImages[0].base64,
        imageMimeType: collectedImages[0].mimeType,
        savedMediaPath: audioSavedPath || collectedImages[0].s3Path,
        savedMediaType: audioSavedPath ? 'audio' : 'image',
        optimizedPreviewPath: collectedImages[0].previewPath,
        optimizedThumbnailPath: collectedImages[0].thumbPath,
        userId: resolvedUserId,
        allImageBase64s: collectedImages.map(i => i.base64),
        allImageMimeTypes: collectedImages.map(i => i.mimeType),
        allSavedMediaPaths: collectedImages.map(i => i.s3Path),
        allOptimizedPreviewPaths: collectedImages.map(i => i.previewPath),
        allOptimizedThumbnailPaths: collectedImages.map(i => i.thumbPath),
        audioDurationSec: durationSec,
        audioTranscriptionStatus,
      });
      if (orderResult) {
        console.log(`[WhatsApp] ✅ Audio+Image order created: ${orderResult.description}`);
      }
    } else {
      // Audio-only (possibly with text)
      const orderResult = await processIncomingMessage({
        source: 'WhatsApp',
        senderName: profileName,
        messageText: finalText,
        phoneNumber,
        imageBase64: null,
        imageMimeType: 'image/jpeg',
        savedMediaPath: audioSavedPath,
        savedMediaType: 'audio',
        optimizedPreviewPath: null,
        optimizedThumbnailPath: null,
        userId: resolvedUserId,
        audioDurationSec: durationSec,
        audioTranscriptionStatus,
      });
      if (orderResult) {
        console.log(`[WhatsApp] ✅ Audio order created: ${orderResult.description}`);
      } else {
        console.log(`[WhatsApp] ⚠️ Audio processing returned no order for ${maskPhoneForLog(phoneNumber)}`);
      }
    }
  } catch (err: any) {
    // ─── CRITICAL: any uncaught error → create a review order, never crash silently ───
    console.error(`[WhatsApp] ❌ processWhatsAppMediaAsync failed for ${maskPhoneForLog(phoneNumber)}:`, err);
    console.log(`[AUDIO] Original: ${originalKB}KB | Compressed: -- | Duration: -- | Decision: error_fallback`);

    try {
      const imagePreviewPaths = collectedImages.map(c => c.previewPath).filter(Boolean);
      const imageThumbnailPaths = collectedImages.map(c => c.thumbPath).filter(Boolean);

      const { createVoiceTooLongReviewOrder } = await import('@/lib/order-intake');
      const result = await createVoiceTooLongReviewOrder({
        source: 'WhatsApp',
        senderName: profileName,
        phoneNumber,
        audioPath: audioSavedPath,
        durationSec: null,
        userId: resolvedUserId,
        imagePreviewPaths,
        imageThumbnailPaths,
        reason: 'uncheckable',
      });
      if (result) {
        console.log(`[WhatsApp] ✅ Error-fallback review order created: ${result.orderId}`);
      }
    } catch (reviewErr) {
      console.error(`[WhatsApp] ❌ Error-fallback review order creation also failed:`, reviewErr);
    }

    logAuditAsync({
      action: 'WHATSAPP_AUDIO_ASYNC_ERROR',
      area: 'WEBHOOK',
      success: false,
      details: {
        phone: maskPhoneForLog(phoneNumber),
        error: err?.message || 'Unknown error',
      },
    });
  }
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
    let audioBuffer: Buffer | null = null;
    let audioMediaContentType: string = '';

    // Collected image data
    const collectedImages: { base64: string; mimeType: string; s3Path: string; previewPath: string; thumbPath: string }[] = [];

    // ─── Resolve userId BEFORE media processing ───
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
          // ─── AUDIO: download + S3 upload only. Heavy processing is async. ───
          hasAudio = true;
          const ext = mediaContentType.includes('ogg') ? 'ogg' : mediaContentType.includes('mp4') ? 'm4a' : 'mp3';
          audioSavedPath = await uploadBufferToS3(buffer, `whatsapp-voice-${Date.now()}.${ext}`, mediaContentType, false);
          audioBuffer = buffer;
          audioMediaContentType = mediaContentType;
          console.log(`[WhatsApp] 🎙️ Audio downloaded: MIME=${mediaContentType}, bytes=${buffer.length}, savedTo=${audioSavedPath}`);
          // No further audio processing here — handled by processWhatsAppMediaAsync below.
        } else if (mediaContentType.startsWith('image/')) {
          // ─── IMAGE PROCESSING — UNCHANGED from original ───
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

    // ─────────────────────────────────────────────────────────────────────
    // PHASE 3: Sofortige TwiML-Response BEFORE async processing.
    // Audio processing runs in background via processWhatsAppMediaAsync.
    // Text/Image orders are also fire-and-forget (unchanged pattern).
    // ─────────────────────────────────────────────────────────────────────

    if (hasAudio && audioBuffer && audioSavedPath) {
      // ─── AUDIO PATH: fire background job, respond immediately ───
      console.log(`[WhatsApp] 🎙️ Audio message from ${maskPhoneForLog(phoneNumber)} (${(audioBuffer.length / 1024).toFixed(0)}KB) — dispatching to background, returning TwiML now`);

      processWhatsAppMediaAsync({
        audioBuffer,
        audioSavedPath,
        mediaContentType: audioMediaContentType,
        phoneNumber,
        profileName,
        resolvedUserId,
        messageText,
        collectedImages,
      }).catch(err => {
        // Belt-and-suspenders: processWhatsAppMediaAsync has its own try/catch,
        // but if something escapes, log it here.
        console.error(`[WhatsApp] ❌ Unhandled error in processWhatsAppMediaAsync:`, err);
      });

      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // ─── TEXT-ONLY (no images, no audio) — fire-and-forget (UNCHANGED) ───
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

    // ─── IMAGE MESSAGE (no audio) → process per-webhook (UNCHANGED) ───
    // CRITICAL SAFETY: Each Twilio webhook has a unique MessageSid.
    // One WhatsApp message (even with multiple images) = one webhook = one order.
    let finalText = messageText;

    const hasImages = collectedImages.length > 0;
    console.log(`[WhatsApp] 🖼️ Image message from ${maskPhoneForLog(phoneNumber)} (SID=${messageSid}, ${collectedImages.length} images, text=${finalText.length}chars) — processing async`);

    processIncomingMessage({
      source: 'WhatsApp',
      senderName: profileName,
      phoneNumber,
      messageText: finalText,
      imageBase64: hasImages ? collectedImages[0].base64 : null,
      imageMimeType: hasImages ? collectedImages[0].mimeType : 'image/jpeg',
      savedMediaPath: hasImages ? collectedImages[0].s3Path : null,
      savedMediaType: hasImages ? 'image' : null,
      optimizedPreviewPath: hasImages ? collectedImages[0].previewPath : null,
      optimizedThumbnailPath: hasImages ? collectedImages[0].thumbPath : null,
      userId: resolvedUserId,
      allImageBase64s: hasImages ? collectedImages.map(i => i.base64) : undefined,
      allImageMimeTypes: hasImages ? collectedImages.map(i => i.mimeType) : undefined,
      allSavedMediaPaths: hasImages ? collectedImages.map(i => i.s3Path) : undefined,
      allOptimizedPreviewPaths: hasImages ? collectedImages.map(i => i.previewPath) : undefined,
      allOptimizedThumbnailPaths: hasImages ? collectedImages.map(i => i.thumbPath) : undefined,
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

// Transcribe audio using LLM
async function transcribeAudio(mp3Buffer: Buffer): Promise<string | null> {
  try {
    console.log(`[WhatsApp] 🎙️ Starting OpenAI transcription upload: bytes=${mp3Buffer.length}`);
  
    const openAiApiKey = process.env.OPENAI_API_KEY;

    if (!openAiApiKey) {
      console.error('[WhatsApp] Missing OPENAI_API_KEY');
      return null;
    }

    const formData = new FormData();

    // IMPORTANT: The buffer is a compressed MP3 from convertAudioToCompactMp3.
    // MIME type and filename MUST match the actual format — OpenAI rejects mismatches.
    formData.append(
      'file',
      new Blob([mp3Buffer], { type: 'audio/mpeg' }),
      'whatsapp-audio.mp3',
    );

    formData.append('model', 'gpt-4o-mini-transcribe');
    formData.append('language', 'de');
    formData.append(
      'prompt',
      'Transkribiere diese WhatsApp-Sprachnachricht auf Hochdeutsch. Schweizerdeutsch und Dialekt in verständliches Hochdeutsch übertragen. Gib nur den transkribierten Text zurück.',
    );

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: formData,
    });

      if (!response.ok) {
      const errorText = await response.text();
      console.error('[WhatsApp] OpenAI transcription error:', response.status, errorText);
      return null;
    }

    const result = await response.json();
    const text = typeof result?.text === 'string' ? result.text.trim() : '';

    if (!text) {
      console.warn('[WhatsApp] OpenAI transcription returned empty text:', JSON.stringify(result));
      return null;
    }

    console.log(`[WhatsApp] ✅ OpenAI transcription success: ${text.length} chars`);

    return text;
  } catch (err) {
    console.error('[WhatsApp] Transcription error:', err);
    return null;
  }
}