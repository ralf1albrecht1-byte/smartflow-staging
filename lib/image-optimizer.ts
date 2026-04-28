import sharp from 'sharp';
import { uploadBufferToS3 } from '@/lib/s3';

interface OptimizedImages {
  previewPath: string;
  thumbnailPath: string;
  /**
   * The in-memory WebP preview buffer (max 1200px wide, quality 75).
   * Use this for downstream AI/LLM vision calls instead of the original
   * image bytes — saves significant tokens/bandwidth.
   */
  previewBuffer: Buffer;
  /** Original byte size, for logging. */
  originalBytes: number;
  /** Optimized preview byte size, for logging. */
  previewBytes: number;
}

/**
 * Optimizes an image buffer: creates WebP preview (max 1200px, 75%) and thumbnail (max 300px, 60%).
 * Falls back to original if optimization fails.
 */
export async function optimizeImage(
  buffer: Buffer,
  originalFileName: string,
  originalContentType: string
): Promise<OptimizedImages | null> {
  try {
    const baseName = originalFileName.replace(/\.[^.]+$/, '');
    const ts = Date.now();

    // Preview: max 1200px wide, WebP 75%
    const previewBuffer = await sharp(buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    // Thumbnail: max 300px wide, WebP 60%
    const thumbnailBuffer = await sharp(buffer)
      .resize({ width: 300, withoutEnlargement: true })
      .webp({ quality: 60 })
      .toBuffer();

    // Upload both to S3
    const previewPath = await uploadBufferToS3(
      previewBuffer,
      `${baseName}-preview-${ts}.webp`,
      'image/webp',
      false
    );

    const thumbnailPath = await uploadBufferToS3(
      thumbnailBuffer,
      `${baseName}-thumb-${ts}.webp`,
      'image/webp',
      false
    );

    console.log(`Image optimized: preview=${(previewBuffer.length / 1024).toFixed(0)}KB, thumb=${(thumbnailBuffer.length / 1024).toFixed(0)}KB (original=${(buffer.length / 1024).toFixed(0)}KB)`);

    return {
      previewPath,
      thumbnailPath,
      previewBuffer,
      originalBytes: buffer.length,
      previewBytes: previewBuffer.length,
    };
  } catch (err) {
    console.error('Image optimization failed, using original as fallback:', err);
    return null;
  }
}

/**
 * In-memory image optimization for inline AI/LLM payloads (Vision).
 * Produces ONLY a WebP preview (max 1200px wide, quality 75) — no S3 upload,
 * no thumbnail. Caller embeds the buffer as data:image/webp;base64,…
 *
 * Falls back to null on any failure → caller MUST fall back to the original
 * image (same semantics as the WhatsApp/Telegram pathway that has been in
 * production for months).
 */
export interface OptimizedAiImage {
  /** WebP preview buffer, max 1200px wide, quality ~75. */
  previewBuffer: Buffer;
  /** Optimized preview byte size, for logging/audit. */
  previewBytes: number;
  /** Original byte size, for logging/audit. */
  originalBytes: number;
  /** Always 'image/webp'. */
  mimeType: 'image/webp';
}

export async function optimizeImageBufferForAi(
  buffer: Buffer,
  originalContentType: string,
): Promise<OptimizedAiImage | null> {
  try {
    const previewBuffer = await sharp(buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    console.log(
      `[ImageOpt-AI] preview=${(previewBuffer.length / 1024).toFixed(0)}KB ` +
      `(orig=${(buffer.length / 1024).toFixed(0)}KB, ${originalContentType})`,
    );

    return {
      previewBuffer,
      previewBytes: previewBuffer.length,
      originalBytes: buffer.length,
      mimeType: 'image/webp',
    };
  } catch (err) {
    console.error('[ImageOpt-AI] failed, caller will fall back to original:', err);
    return null;
  }
}
