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
