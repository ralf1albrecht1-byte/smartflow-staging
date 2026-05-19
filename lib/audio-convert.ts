import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

/**
 * Probe audio duration using system ffprobe
 * Returns duration in seconds, or null if unavailable/failed
 */
export async function probeAudioDuration(buffer: Buffer): Promise<number | null> {
  let tempPath: string | null = null;
  
  try {
    // Write buffer to temp file
    tempPath = path.join(os.tmpdir(), `audio-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`);
    await fs.promises.writeFile(tempPath, buffer);
    
    // Call system ffprobe
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      tempPath
    ], { timeout: 5000 });
    
    const duration = parseFloat(stdout.trim());
    
    if (isNaN(duration) || duration <= 0) {
      console.error('[FFPROBE] Invalid duration:', stdout);
      return null;
    }
    
    console.log(`[FFPROBE] Duration: ${duration.toFixed(1)}s`);
    return duration;
    
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('[FFPROBE] FFmpeg not installed on system');
    } else {
      console.error('[FFPROBE] Failed:', error.message);
    }
    return null;
  } finally {
    // Cleanup temp file
    if (tempPath) {
      try {
        await fs.promises.unlink(tempPath);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Convert audio buffer to compact MP3 (mono, 16kHz, 64kbps, libmp3lame)
 * Returns compressed buffer, or null if failed
 */
export async function convertAudioToCompactMp3(buffer: Buffer): Promise<Buffer | null> {
  let inputPath: string | null = null;
  let outputPath: string | null = null;
  
  try {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2);
    
    // Write input buffer to temp file
    inputPath = path.join(os.tmpdir(), `audio-input-${timestamp}-${random}.ogg`);
    outputPath = path.join(os.tmpdir(), `audio-output-${timestamp}-${random}.mp3`);
    
    await fs.promises.writeFile(inputPath, buffer);
    
    const inputSizeKB = Math.round(buffer.length / 1024);
    
    // Call system ffmpeg — explicit libmp3lame codec for OpenAI compatibility
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-codec:a', 'libmp3lame', // explicit MP3 codec (OpenAI requirement)
      '-ac', '1',               // mono
      '-ar', '16000',           // 16kHz sample rate
      '-ab', '64k',             // 64kbps bitrate (OpenAI-safe minimum)
      '-f', 'mp3',
      '-y',                     // overwrite
      outputPath
    ], { timeout: 10000 });
    
    // Read compressed output
    const compressedBuffer = await fs.promises.readFile(outputPath);
    const outputSizeKB = Math.round(compressedBuffer.length / 1024);
    
    console.log(`[FFMPEG] Compressed: ${inputSizeKB}KB → ${outputSizeKB}KB`);
    
    return compressedBuffer;
    
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('[FFMPEG] FFmpeg not installed on system');
    } else {
      console.error('[FFMPEG] Compression failed:', error.message);
    }
    return null;
  } finally {
    // Cleanup temp files
    if (inputPath) {
      try {
        await fs.promises.unlink(inputPath);
      } catch (err) {
        // Ignore
      }
    }
    if (outputPath) {
      try {
        await fs.promises.unlink(outputPath);
      } catch (err) {
        // Ignore
      }
    }
  }
}
