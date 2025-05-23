/**
 * utils/retry.ts
 * ------------------------------------------------------
 * Generic exponential-back-off helper with full jitter.
 *
 * Example:
 *   await retry(() => fetch(url), 5, 250)
 *
 * Parameters
 * ----------
 *  fn        :  Promise-returning function to attempt
 *  attempts  :  Maximum attempts (>=1).  First call is
 *               attempt #1; when attempts === 1 no retry.
 *  baseDelay :  Initial back-off delay in milliseconds
 *               (default 250 ms).  Delay grows as:
 *
 *                 delay = baseDelay * 2^(n-1)
 *                 jitter = random(0, delay)
 *                 await jitter
 *
 *  onError   :  Optional hook (err, attemptNo) => void
 *               Called *before* waiting/retrying.
 * ------------------------------------------------------
 */

export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 5,
  baseDelay = 250,
  onError?: (err: unknown, attempt: number) => void
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      attempt++;
      return await fn();
    } catch (err) {
      onError?.(err, attempt);
      if (attempt >= attempts) throw err;

      /* Exponential back-off with full jitter */
      const exp = baseDelay * 2 ** (attempt - 1);
      const jitter = Math.random() * exp;
      await new Promise((res) => setTimeout(res, jitter));
    }
  }
}
