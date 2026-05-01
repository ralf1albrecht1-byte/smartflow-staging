export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { deleteFile } from '@/lib/s3';

export async function POST(request: Request) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'Keine Datei' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const mimeType = file.type || 'audio/ogg';

    // ─── Stage K: server-side audio-quota gate ───
    // Probe duration BEFORE transcribing. If the user's monthly transcription
    // quota (Standard plan = 20 min) is exhausted OR the duration cannot be
    // determined safely (fail-safe), we MUST NOT transcribe — block with
    // a clear German warning so the user knows to switch to manual entry.
    let audioDurationSec: number | null = null;
    try {
      const { parseBuffer } = await import('music-metadata');
      const meta = await parseBuffer(buffer, { mimeType });
      const dur = meta?.format?.duration;
      if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
        audioDurationSec = dur;
      }
    } catch (durErr: any) {
      console.warn(`[Transcribe] ⚠️ Duration probe (with mime) failed: ${durErr?.message || durErr}`);
    }
    if (audioDurationSec === null) {
      // Retry without mime hint
      try {
        const { parseBuffer } = await import('music-metadata');
        const meta = await parseBuffer(buffer);
        const dur = meta?.format?.duration;
        if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
          audioDurationSec = dur;
        }
      } catch (durErr: any) {
        console.warn(`[Transcribe] ⚠️ Duration probe (no mime hint) failed: ${durErr?.message || durErr}`);
      }
    }

    // ─── COST PROTECTION: 60-s hard cap (Item 2) — BEFORE quota gate ───
    // If we KNOW the audio is longer than 60 s, block immediately so that
    // even users with available quota cannot trigger long LLM-audio calls.
    // If duration is unknown (probe failed), the existing quota gate below
    // already blocks with `quota_unknown` — status quo preserved.
    const MAX_AUDIO_DURATION_SEC = 60;
    if (audioDurationSec !== null && audioDurationSec > MAX_AUDIO_DURATION_SEC) {
      console.warn(
        `[Transcribe] 🛑 BLOCKED user=${userId} reason=voice_too_long durationSec=${audioDurationSec.toFixed(1)}`,
      );
      logAuditAsync({
        userId,
        action: 'AUDIO_TRANSCRIBE_TOO_LONG',
        area: 'API',
        success: false,
        details: {
          endpoint: '/api/transcribe',
          durationSec: Math.round(audioDurationSec),
          maxAllowedSec: MAX_AUDIO_DURATION_SEC,
          fileBytes: buffer.length,
          mimeType,
        },
      });
      return NextResponse.json(
        {
          error: '⚠️ Audio zu lang – maximal 60 Sekunden pro Sprachnachricht.',
          blocked: true,
          reason: 'voice_too_long',
          durationSec: Math.round(audioDurationSec),
          maxAllowedSec: MAX_AUDIO_DURATION_SEC,
        },
        { status: 413 },
      );
    }

    const { checkAudioTranscriptionQuota } = await import('@/lib/audio-quota');
    const quota = await checkAudioTranscriptionQuota(userId, audioDurationSec);
    if (!quota.allowTranscription) {
      let blockMsg: string;
      if (quota.reason === 'quota_exceeded') {
        blockMsg = '⚠️ Monatliches Audio-Limit erreicht – bitte manuell prüfen';
      } else if (quota.reason === 'quota_unknown') {
        blockMsg = '⚠️ Audio-Dauer konnte nicht geprüft werden – bitte manuell transkribieren';
      } else {
        blockMsg = '⚠️ Audio-Transkription blockiert – bitte manuell prüfen';
      }
      console.warn(`[Transcribe] 🛑 BLOCKED user=${userId} reason=${quota.reason} used=${quota.usedMinutes}/${quota.includedMinutes}min`);
      logAuditAsync({
        userId,
        action: 'AUDIO_QUOTA_BLOCKED_API',
        area: 'API',
        details: {
          endpoint: '/api/transcribe',
          reason: quota.reason,
          usedMinutes: quota.usedMinutes,
          includedMinutes: quota.includedMinutes,
          requestedDurationSec: audioDurationSec,
          fileBytes: buffer.length,
        },
      });
      return NextResponse.json(
        {
          error: blockMsg,
          blocked: true,
          reason: quota.reason,
          usedMinutes: quota.usedMinutes,
          includedMinutes: quota.includedMinutes,
        },
        { status: 429 }
      );
    }

    // ─── COST PROTECTION: convert to compact MP3 before LLM (Item 3) ───
    // Convert to mono / 16 kHz / 64 kbps via the FFmpeg API. On any failure
    // we silently fall back to the original buffer — never break the flow.
    let llmAudioBase64: string = base64;
    let llmAudioFormat: 'mp3' | 'mp4' | 'wav' =
      mimeType.includes('mp4') || mimeType.includes('m4a')
        ? 'mp4'
        : mimeType.includes('wav')
          ? 'wav'
          : 'mp3';
    let convertedToCompactMp3 = false;
    let convertedBytes: number | null = null;

    try {
      const { uploadBufferToS3, getFileUrl } = await import('@/lib/s3');
      const { convertAudioToCompactMp3 } = await import('@/lib/audio-convert');

      const ext = mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('mp4') || mimeType.includes('m4a')
          ? 'm4a'
          : mimeType.includes('wav')
            ? 'wav'
            : 'mp3';
      let tempKeyToCleanup: string | null = null;

      try {
        const tmpKey = await uploadBufferToS3(
          buffer,
          `transcribe-tmp-${Date.now()}.${ext}`,
          mimeType,
          false,
        );
        tempKeyToCleanup = tmpKey;
        const signedUrl = await getFileUrl(tmpKey, false);

        const compactMp3 = await convertAudioToCompactMp3(signedUrl);
        if (compactMp3 && compactMp3.length > 0) {
          llmAudioBase64 = compactMp3.toString('base64');
          llmAudioFormat = 'mp3';
          convertedToCompactMp3 = true;
          convertedBytes = compactMp3.length;
          console.log(
            `[Transcribe] 🎚️ Compact MP3: ${(compactMp3.length / 1024).toFixed(0)}KB ` +
            `(orig=${(buffer.length / 1024).toFixed(0)}KB)`,
          );
        } else {
          console.warn(
            `[Transcribe] ⚠️ Compact MP3 conversion failed — falling back to original ` +
            `(${(buffer.length / 1024).toFixed(0)}KB, ${mimeType})`,
          );
        }
      } finally {
        if (tempKeyToCleanup) {
          try {
            await deleteFile(tempKeyToCleanup);
            console.log(`[Transcribe] Cleaned up temp file: ${tempKeyToCleanup}`);
          } catch (cleanupError) {
            console.error(`[Transcribe] Failed to cleanup temp file ${tempKeyToCleanup}:`, cleanupError);
          }
        }
      }
    } catch (convErr: any) {
      console.warn(
        '[Transcribe] ⚠️ Conversion pipeline error, falling back to original:',
        convErr?.message || convErr,
      );
    }

    logAuditAsync({
      userId,
      action: 'AUDIO_TRANSCRIBE_PAYLOAD',
      area: 'API',
      details: {
        endpoint: '/api/transcribe',
        convertedToCompactMp3,
        originalBytes: buffer.length,
        payloadBytes: convertedBytes ?? buffer.length,
        durationSec: audioDurationSec !== null ? Math.round(audioDurationSec) : null,
        mimeType,
      },
    });

    // Use audio model for transcription
    const response = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ABACUSAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-audio-preview-2025-06-03',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transkribiere diese Sprachnachricht wortwörtlich auf Deutsch. Gib nur den transkribierten Text zurück, nichts anderes.' },
              {
                type: 'input_audio',
                input_audio: {
                  data: llmAudioBase64,
                  format: llmAudioFormat,
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Transcription API error:', errorText);
      return NextResponse.json({ error: 'Transkription fehlgeschlagen' }, { status: 500 });
    }

    const result = await response.json();
    const text = result?.choices?.[0]?.message?.content ?? '';

    return NextResponse.json({ text });
  } catch (error: any) {
    console.error('Transcription error:', error);
    return NextResponse.json({ error: 'Fehler bei der Transkription' }, { status: 500 });
  }
}
