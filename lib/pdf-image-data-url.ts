const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || 'unknown-host';
  } catch {
    return 'invalid-url';
  }
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a) {
    return 'image/png';
  }

  if (buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= 6) {
    const header6 = buffer.subarray(0, 6).toString('ascii');
    if (header6 === 'GIF87a' || header6 === 'GIF89a') {
      return 'image/gif';
    }
  }

  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') {
      return 'image/webp';
    }
  }

  if (buffer.length >= 12 &&
      buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') {
      return 'image/avif';
    }
  }

  const textHead = buffer.subarray(0, 2048).toString('utf8').trimStart().toLowerCase();
  if (textHead.startsWith('<svg') || (textHead.startsWith('<?xml') && textHead.includes('<svg'))) {
    return 'image/svg+xml';
  }

  return null;
}

function normalizeImageMimeType(contentTypeHeader: string | null): string | null {
  if (!contentTypeHeader) {
    return null;
  }

  const mime = contentTypeHeader.split(';')[0].trim().toLowerCase();
  return mime.startsWith('image/') ? mime : null;
}

function safeWarn(host: string, reason: string): void {
  console.warn(`[pdf-image-data-url] host=${host} reason=${reason}`);
}

export async function toImageDataUrl(imageUrl: string): Promise<string | null> {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return null;
  }

  const host = hostFromUrl(imageUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(imageUrl, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      safeWarn(host, `http_${response.status}`);
      return null;
    }

    const contentLengthRaw = response.headers.get('content-length');
    if (contentLengthRaw) {
      const contentLength = Number.parseInt(contentLengthRaw, 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
        safeWarn(host, 'too_large_header');
        return null;
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!buffer.length) {
      safeWarn(host, 'empty_body');
      return null;
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      safeWarn(host, 'too_large_body');
      return null;
    }

    const mimeFromHeader = normalizeImageMimeType(response.headers.get('content-type'));
    const mimeFromBuffer = detectImageMimeTypeFromBuffer(buffer);
    const mimeType = mimeFromHeader ?? mimeFromBuffer;

    if (!mimeType) {
      safeWarn(host, 'invalid_image_format');
      return null;
    }

    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      safeWarn(host, 'timeout');
      return null;
    }

    safeWarn(host, 'fetch_failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
