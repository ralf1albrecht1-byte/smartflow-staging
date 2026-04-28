/**
 * Shared fetch helper with retry logic for transient failures.
 * Replaces the fragile `fetch(url).then(r => r.json())` pattern.
 *
 * - Checks response status before parsing JSON
 * - Handles non-JSON error responses safely
 * - Retries once on transient errors (500, 502, 503, 504, network failures)
 * - Returns a typed result or throws with a clear message
 */

const TRANSIENT_STATUS_CODES = new Set([500, 502, 503, 504]);
const RETRY_DELAY_MS = 800;

export class FetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

/**
 * Fetches JSON from a URL with automatic retry for transient failures.
 * @param url - API endpoint
 * @param options - fetch options (optional)
 * @param retries - number of retries for transient errors (default: 1)
 * @returns parsed JSON response
 * @throws FetchError with status code and message
 */
export async function fetchJSON<T = any>(
  url: string,
  options?: RequestInit,
  retries: number = 1
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Success — parse JSON
      if (res.ok) {
        try {
          return await res.json() as T;
        } catch {
          // Response was 2xx but body isn't valid JSON
          throw new FetchError('Ungültige Server-Antwort (kein JSON)', res.status);
        }
      }

      // Transient error — retry if attempts remain
      if (TRANSIENT_STATUS_CODES.has(res.status) && attempt < retries) {
        console.warn(`[fetchJSON] ${url} returned ${res.status}, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // Non-transient error or retries exhausted — extract error message
      let errorMsg = `Server-Fehler (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) errorMsg = body.error;
      } catch {
        // Body wasn't JSON, use status-based message
      }
      throw new FetchError(errorMsg, res.status);

    } catch (err) {
      // Network error (no response at all)
      if (err instanceof FetchError) throw err;

      lastError = err as Error;
      if (attempt < retries) {
        console.warn(`[fetchJSON] ${url} network error, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${retries}):`, (err as Error).message);
        await sleep(RETRY_DELAY_MS);
        continue;
      }
    }
  }

  throw new FetchError(
    lastError?.message || 'Netzwerkfehler — Server nicht erreichbar',
    0
  );
}

/**
 * Fetches multiple JSON endpoints in parallel.
 * Unlike Promise.all, this uses Promise.allSettled so one failure
 * doesn't kill all others. Returns results with defaults for failures.
 */
export async function fetchAllJSON<T extends any[]>(
  requests: { url: string; options?: RequestInit; fallback: any }[]
): Promise<{ results: T; errors: string[] }> {
  const settled = await Promise.allSettled(
    requests.map(r => fetchJSON(r.url, r.options))
  );

  const results: any[] = [];
  const errors: string[] = [];

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      const msg = result.reason?.message || 'Unbekannter Fehler';
      errors.push(`${requests[i].url}: ${msg}`);
      results.push(requests[i].fallback);
      console.error(`[fetchAllJSON] ${requests[i].url} failed:`, msg);
    }
  });

  return { results: results as T, errors };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
