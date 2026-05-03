import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createS3Client, getBucketConfig } from './aws-config';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const SIGNED_URL_TTL_SECONDS = 120;

const s3Client = createS3Client();

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || 'unknown-host';
  } catch {
    return 'invalid-url';
  }
}

function safeLog(message: string, details?: Record<string, unknown>): void {
  if (!details) {
    console.log(`[pdf-image-data-url] ${message}`);
    return;
  }
  console.log(`[pdf-image-data-url] ${message} ${JSON.stringify(details)}`);
}

function safeWarn(host: string, reason: string, details?: Record<string, unknown>): void {
  if (!details) {
    console.warn(`[pdf-image-data-url] host=${host} reason=${reason}`);
    return;
  }
  console.warn(`[pdf-image-data-url] host=${host} reason=${reason} details=${JSON.stringify(details)}`);
}

function normalizeImageMimeType(contentTypeHeader: string | null): string | null {
  if (!contentTypeHeader) {
    return null;
  }

  const mime = contentTypeHeader.split(';')[0].trim().toLowerCase();
  return mime.startsWith('image/') ? mime : null;
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
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

  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
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

function deriveS3KeyFromUrl(imageUrl: string): string | null {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^\/+/, '');
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const { bucketName } = getBucketConfig();

    if (!pathname) {
      return null;
    }

    // virtual-hosted style: <bucket>.s3.<region>.amazonaws.com/<key>
    if (bucketName && parsed.host.startsWith(`${bucketName}.s3`)) {
      return pathname;
    }

    // path-style: s3.<region>.amazonaws.com/<bucket>/<key>
    if (bucketName && (parsed.host.startsWith('s3.') || parsed.host === 's3.amazonaws.com')) {
      if (pathname.startsWith(`${bucketName}/`)) {
        return pathname.substring(bucketName.length + 1);
      }
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

type FetchAttemptSuccess = { ok: true; response: Response };
type FetchAttemptFailure = { ok: false; reason: string; status?: number };
type FetchAttemptResult = FetchAttemptSuccess | FetchAttemptFailure;

function isFetchAttemptFailure(result: FetchAttemptResult): result is FetchAttemptFailure {
  return result.ok === false;
}

async function fetchWithTimeout(url: string): Promise<FetchAttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    return { ok: true, response };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }

    const errorName = typeof error?.name === 'string' ? error.name : 'unknown_error';
    return { ok: false, reason: `fetch_exception_${errorName}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function createSignedGetUrl(imageUrl: string): Promise<string | null> {
  const { bucketName } = getBucketConfig();
  if (!bucketName) {
    return null;
  }

  const key = deriveS3KeyFromUrl(imageUrl);
  if (!key) {
    return null;
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn: SIGNED_URL_TTL_SECONDS });
}

function logResponseMeta(host: string, source: 'direct' | 'signed', response: Response): void {
  const contentType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');
  safeLog('fetch_response_meta', {
    host,
    source,
    status: response.status,
    contentType: contentType ?? null,
    contentLength: contentLength ?? null,
  });
}

export async function toImageDataUrl(imageUrl: string): Promise<string | null> {
  const hasLetterheadUrl = typeof imageUrl === 'string' && imageUrl.trim().length > 0;
  safeLog('to_image_data_url_start', { letterheadUrlExists: hasLetterheadUrl });

  if (!hasLetterheadUrl) {
    return null;
  }

  const host = hostFromUrl(imageUrl);

  const directResult = await fetchWithTimeout(imageUrl);
  if (isFetchAttemptFailure(directResult)) {
    safeWarn(host, directResult.reason);
  } else {
    logResponseMeta(host, 'direct', directResult.response);
  }

  let response: Response | null = directResult.ok ? directResult.response : null;

  const directStatus = directResult.ok ? directResult.response.status : undefined;
  const shouldTrySignedS3 = !response || directStatus === 401 || directStatus === 403;

  if (shouldTrySignedS3) {
    try {
      const signedUrl = await createSignedGetUrl(imageUrl);
      if (signedUrl) {
        safeLog('trying_signed_s3_fetch', { host });
        const signedResult = await fetchWithTimeout(signedUrl);
        if (isFetchAttemptFailure(signedResult)) {
          safeWarn(host, `signed_${signedResult.reason}`);
        } else {
          logResponseMeta(host, 'signed', signedResult.response);
          response = signedResult.response;
        }
      } else {
        safeLog('signed_s3_not_applicable', { host });
      }
    } catch (error: any) {
      const errorName = typeof error?.name === 'string' ? error.name : 'unknown_error';
      safeWarn(host, `signed_url_generation_failed_${errorName}`);
    }
  }

  if (!response) {
    return null;
  }

  if (!response.ok) {
    safeWarn(host, `http_${response.status}`);
    return null;
  }

  const contentLengthRaw = response.headers.get('content-length');
  if (contentLengthRaw) {
    const contentLength = Number.parseInt(contentLengthRaw, 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      safeWarn(host, 'too_large_header', { maxBytes: MAX_IMAGE_BYTES });
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
    safeWarn(host, 'too_large_body', { bytes: buffer.length, maxBytes: MAX_IMAGE_BYTES });
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
  if (!base64 || base64.length === 0) {
    safeWarn(host, 'empty_base64');
    return null;
  }

  safeLog('image_to_base64_success', {
    host,
    bytes: buffer.length,
    base64Length: base64.length,
    mimeType,
  });

  return `data:${mimeType};base64,${base64}`;
}
