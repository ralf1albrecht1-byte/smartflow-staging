/**
 * Local FFmpeg-based audio conversion and duration probing.
 *
 * Replaces the previous Abacus.ai FFmpeg API with local fluent-ffmpeg.
 * All processing is Buffer-in / Buffer-out via temporary files.
 *
 * Exports:
 *   - probeAudioDuration(buffer)       → duration in seconds or null
 *   - convertAudioToCompactMp3(buffer) → compressed MP3 Buffer or null
 *
 * Audio output spec:
 *   - MP3 (libmp3lame)
 *   - Mono (-ac 1)
 *   - 16 kHz (-ar 16000)
 *   - 32 kbps (-b:a 32k)
 *
 * Error handling:
 *   - Both functions return null on ANY failure — callers must handle gracefully.
 *   - Temporary files are always cleaned up via try/finally.
 */

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

// Point fluent-ffmpeg to the installed binary
ffmpeg.setFfmpegPath(ffmpegPath.path);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique temp file path with the given extension. */
function tmpFile(ext: string): string {
  return join(tmpdir(), `audio-${randomUUID()}.${ext}`);
}

/** Safely remove a file, ignoring errors if it doesn't exist. */
async function safeUnlink(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    // file may already be gone — ignore
  }
}

// ---------------------------------------------------------------------------
// A) probeAudioDuration
// ---------------------------------------------------------------------------

/**
 * Probe the duration of an audio buffer using ffprobe.
 *
 * @param buffer - Raw audio bytes (any format FFmpeg can read)
 * @returns Duration in seconds, or null on failure
 */
export async function probeAudioDuration(
  buffer: Buffer,
): Promise<number | null> {
  const tmp = tmpFile('ogg');

  try {
    await fs.writeFile(tmp, buffer);

    const duration = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        console.error('[FFPROBE] Timeout after 5 s');
        resolve(null);
      }, 5_000);

      ffmpeg.ffprobe(tmp, (err, metadata) => {
        clearTimeout(timer);
        if (err) {
          console.error('[FFPROBE] Failed:', err.message || err);
          resolve(null);
          return;
        }
        const dur = metadata?.format?.duration;
        if (typeof dur === 'number' && dur > 0) {
          console.log(`[FFPROBE] Duration: ${dur.toFixed(1)}s`);
          resolve(dur);
        } else {
          console.error('[FFPROBE] No valid duration in metadata');
          resolve(null);
        }
      });
    });

    return duration;
  } catch (err: any) {
    console.error('[FFPROBE] Failed:', err?.message || err);
    return null;
  } finally {
    await safeUnlink(tmp);
  }
}

// ---------------------------------------------------------------------------
// B) convertAudioToCompactMp3
// ---------------------------------------------------------------------------

/**
 * Compress an audio buffer to a compact MP3 via local FFmpeg.
 *
 * Output spec: MP3 · mono · 16 kHz · 32 kbps
 *
 * @param buffer - Raw audio bytes (any format FFmpeg can read)
 * @returns Compressed MP3 buffer, or null on failure
 */
export async function convertAudioToCompactMp3(
  buffer: Buffer,
): Promise<Buffer | null> {
  const inputPath = tmpFile('input');
  const outputPath = tmpFile('mp3');

  try {
    await fs.writeFile(inputPath, buffer);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('FFmpeg timeout after 10 s'));
      }, 10_000);

      ffmpeg(inputPath)
        .audioCodec('libmp3lame')
        .audioChannels(1)       // mono
        .audioFrequency(16000)  // 16 kHz
        .audioBitrate('32k')    // 32 kbps
        .format('mp3')
        .on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        })
        .on('end', () => {
          clearTimeout(timer);
          resolve();
        })
        .save(outputPath);
    });

    const outputBuffer = await fs.readFile(outputPath);

    if (outputBuffer.length === 0) {
      console.error('[FFMPEG] Output buffer is empty');
      return null;
    }

    console.log(
      `[FFMPEG] Compressed: ${buffer.length} → ${outputBuffer.length} bytes`,
    );
    return outputBuffer;
  } catch (err: any) {
    console.error('[FFMPEG] Failed:', err?.message || err);
    return null;
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
  }
}
