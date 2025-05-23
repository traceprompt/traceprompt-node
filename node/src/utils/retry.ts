export async function retry<T>(
  fn: () => Promise<T>,
  max: number,
  delayMs = 250
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (max === 0) throw err;
    await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, 5 - max)));
    return retry(fn, max - 1, delayMs);
  }
}
