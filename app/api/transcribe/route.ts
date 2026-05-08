export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    let userId: string;

    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'audio/ogg';

    let audioDurationSec: number | null = null;

    try {
      const { parseBuffer } = await import('music-metadata');
      const meta = await parseBuffer(buffer, { mimeType });
      const dur = meta?.format?.duration;

      if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
        audioDurationSec = dur;
      }
    } catch (durErr: any) {
      console.warn(`[Transcribe] Duration probe with mime failed: ${durErr?.message || durErr}`);
    }

    if (audioDurationSec === null) {
      try {
        const { parseBuffer } = await import('music-metadata');
        const meta = await parseBuffer(buffer);
        const dur = meta?.format?.duration;

        if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
          audioDurationSec = dur;
        }
      } catch (durErr: any) {
        console.warn(`[Transcribe] Duration probe without mime failed: ${durErr?.message || durErr}`);
      }
    }

    const MAX_AUDIO_DURATION_SEC = 60;

    if (audioDurationSec !== null && audioDurationSec > MAX_AUDIO_DURATION_SEC) {
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
      const blockMsg =
        quota.reason === 'quota_exceeded'
          ? '⚠️ Monatliches Audio-Limit erreicht – bitte manuell prüfen'
          : quota.reason === 'quota_unknown'
            ? '⚠️ Audio-Dauer konnte nicht geprüft werden – bitte manuell transkribieren'
            : '⚠️ Audio-Transkription blockiert – bitte manuell prüfen';

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
        { status: 429 },
      );
    }

    const openAiApiKey = process.env.OPENAI_API_KEY;

    if (!openAiApiKey) {
      console.error('[Transcribe] Missing OPENAI_API_KEY');

      return NextResponse.json(
        { error: 'Transkription ist aktuell nicht konfiguriert' },
        { status: 500 },
      );
    }

    const transcriptionFormData = new FormData();

    transcriptionFormData.append(
      'file',
      new Blob([buffer], { type: mimeType }),
      file.name || 'audio.ogg',
    );

    transcriptionFormData.append('model', 'gpt-4o-mini-transcribe');
    transcriptionFormData.append('language', 'de');
    transcriptionFormData.append(
      'prompt',
      'Transkribiere diese deutschsprachige Sprachnachricht wortwörtlich. Gib nur den transkribierten Text zurück.',
    );

    logAuditAsync({
      userId,
      action: 'AUDIO_TRANSCRIBE_PAYLOAD',
      area: 'API',
      details: {
        endpoint: '/api/transcribe',
        provider: 'openai',
        model: 'gpt-4o-mini-transcribe',
        originalBytes: buffer.length,
        durationSec: audioDurationSec !== null ? Math.round(audioDurationSec) : null,
        mimeType,
      },
    });

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: transcriptionFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Transcribe] OpenAI transcription error:', errorText);

      return NextResponse.json(
        { error: 'Transkription fehlgeschlagen' },
        { status: 500 },
      );
    }

    const result = await response.json();
    const text = typeof result?.text === 'string' ? result.text.trim() : '';

    return NextResponse.json({ text });
  } catch (error: any) {
    console.error('[Transcribe] Error:', error);

    return NextResponse.json(
      { error: 'Fehler bei der Transkription' },
      { status: 500 },
    );
  }
}