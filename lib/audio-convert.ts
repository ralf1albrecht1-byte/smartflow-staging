/**
 * Reusable FFmpeg-API wrapper for cost-protection audio conversion.
 *
 * Converts an audio file at a publicly-reachable URL into a compact MP3:
 *   - mono   (-ac 1)
 *   - 16 kHz (-ar 16000)
 *   - 64 kbps (-b:a 64k)
 *
 * Used by:
 *   - /api/transcribe  → reduce LLM-audio token usage before transcription
 *
 * Constraints / behavior:
 *   - The input URL MUST be reachable from the Abacus FFmpeg API
 *     (a presigned/public S3 URL is the canonical way).
 *   - Returns null on ANY failure (HTTP error, FFmpeg failure, timeout,
 *     network error). Callers MUST fall back to the original buffer to
 *     keep the flow stable — never break the user-facing request because
 *     conversion did not succeed.
 */

export interface ConvertAudioOptions {
  /** Polling timeout in seconds. Default 90. */
  timeoutSec?: number;
}

export async function convertAudioToCompactMp3(
  audioUrl: string,
  options: ConvertAudioOptions = {},
): Promise<Buffer | null> {
  const timeoutSec = options.timeoutSec ?? 90;
  const apiKey = process.env.ABACUSAI_API_KEY;

  if (!apiKey) {
    console.error('[audio-convert] ABACUSAI_API_KEY missing');
    return null;
  }
  if (!audioUrl) {
    console.error('[audio-convert] empty audioUrl');
    return null;
  }

  try {
    // 1) Submit FFmpeg request
    const createRes = await fetch(
      'https://apps.abacus.ai/api/createRunFfmpegCommandRequest',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_token: apiKey,
          input_files: { in_1: audioUrl },
          output_files: { out_1: 'audio.mp3' },
          ffmpeg_command:
            '-i {{in_1}} -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k {{out_1}}',
        }),
      },
    );
    if (!createRes.ok) {
      const txt = await createRes.text().catch(() => '');
      console.error('[audio-convert] create failed:', createRes.status, txt.slice(0, 300));
      return null;
    }
    const createJson: any = await createRes.json().catch(() => ({}));
    const requestId: string | undefined = createJson?.request_id;
    if (!requestId) {
      console.error('[audio-convert] no request_id in response');
      return null;
    }

    // 2) Poll status
    for (let i = 0; i < timeoutSec; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusRes = await fetch(
        'https://apps.abacus.ai/api/getRunFfmpegCommandStatus',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: requestId, deployment_token: apiKey }),
        },
      );
      if (!statusRes.ok) {
        // transient — continue polling
        continue;
      }
      const statusJson: any = await statusRes.json().catch(() => ({}));
      const status = statusJson?.status;

      if (status === 'SUCCESS') {
        const outUrl: string | undefined = statusJson?.result?.result?.out_1;
        if (!outUrl) {
          console.error('[audio-convert] SUCCESS without out_1 url');
          return null;
        }
        const mp3Res = await fetch(outUrl);
        if (!mp3Res.ok) {
          console.error('[audio-convert] mp3 download failed:', mp3Res.status);
          return null;
        }
        const ab = await mp3Res.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length === 0) {
          console.error('[audio-convert] empty mp3 buffer');
          return null;
        }
        return buf;
      }
      if (status === 'FAILED') {
        const errMsg = statusJson?.result?.error || statusJson?.error || 'unknown';
        console.error('[audio-convert] FFmpeg FAILED:', errMsg);
        return null;
      }
      // PENDING / RUNNING / IN_PROGRESS → keep polling
    }

    console.warn(`[audio-convert] timeout after ${timeoutSec}s`);
    return null;
  } catch (err: any) {
    console.error('[audio-convert] error:', err?.message || err);
    return null;
  }
}
