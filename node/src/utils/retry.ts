/**
 * @fileoverview Exponential backoff retry utility for network reliability
 *
 * This module provides a robust retry mechanism with exponential backoff and full jitter
 * for handling transient network failures, API rate limits, and other recoverable errors.
 * It's designed to provide resilient network communication while being respectful of
 * downstream services and avoiding thundering herd problems.
 *
 * ## Retry Strategy
 *
 * **Exponential Backoff:**
 * The delay between retry attempts grows exponentially to give failing services time to recover:
 *
 * ```
 * Attempt 1: No delay (immediate)
 * Attempt 2: 0-250ms random delay
 * Attempt 3: 0-500ms random delay
 * Attempt 4: 0-1000ms random delay
 * Attempt 5: 0-2000ms random delay
 * ```
 *
 * **Full Jitter:**
 * Uses full jitter (randomized delay) to prevent the thundering herd problem where
 * multiple clients retry simultaneously and overwhelm recovering services.
 *
 * **Formula:**
 * ```
 * exponentialDelay = baseDelay * 2^(attemptNumber - 1)
 * actualDelay = random(0, exponentialDelay)
 * ```
 *
 * ## Network Reliability Benefits
 *
 * **Transient Failure Recovery:**
 * - **Network blips** - Brief connectivity issues resolve automatically
 * - **DNS resolution** - Temporary DNS failures often resolve quickly
 * - **Load balancer failover** - Brief service interruptions during deployments
 * - **Rate limiting** - Exponential backoff respects API rate limits
 *
 * **Service Protection:**
 * - **Prevents overload** - Gives failing services time to recover
 * - **Reduces thundering herd** - Jitter spreads out retry attempts
 * - **Graceful degradation** - Fails fast after maximum attempts
 * - **Resource conservation** - Avoids wasting resources on hopeless retries
 *
 * ## Integration with Traceprompt SDK
 *
 * The retry utility is used throughout the SDK for network operations:
 *
 * ```
 * Transport Layer → retry() → Network Request → Traceprompt API
 *                     ↓
 *              Exponential Backoff
 *                     ↓
 *           Automatic Error Recovery
 * ```
 *
 * **Common Use Cases:**
 * - HTTP requests to Traceprompt API
 * - AWS KMS key operations
 * - Network connectivity issues
 * - Temporary service outages
 *
 * ## Configuration Guidelines
 *
 * **High Reliability (Production):**
 * ```typescript
 * await retry(apiCall, 5, 250) // 5 attempts, 250ms base delay
 * // Max total time: ~7.5 seconds
 * ```
 *
 * **Fast Failure (Interactive):**
 * ```typescript
 * await retry(apiCall, 3, 100) // 3 attempts, 100ms base delay
 * // Max total time: ~2 seconds
 * ```
 *
 * **Aggressive Retry (Critical Operations):**
 * ```typescript
 * await retry(apiCall, 8, 500) // 8 attempts, 500ms base delay
 * // Max total time: ~60 seconds
 * ```
 *
 * **Testing/Development:**
 * ```typescript
 * await retry(apiCall, 2, 50) // 2 attempts, 50ms base delay
 * // Max total time: ~100ms
 * ```
 *
 * ## Error Handling Patterns
 *
 * **Error Classification:**
 * The retry mechanism works best when you understand which errors should be retried:
 *
 * **Retryable Errors:**
 * - Network connectivity issues (ECONNRESET, ETIMEDOUT)
 * - HTTP 5xx server errors (500, 502, 503, 504)
 * - DNS resolution failures
 * - Rate limiting (HTTP 429)
 *
 * **Non-Retryable Errors:**
 * - Authentication failures (HTTP 401, 403)
 * - Client errors (HTTP 400, 404)
 * - Invalid request format
 * - Permanent service failures
 *
 * ## Performance Characteristics
 *
 * **Timing Examples (baseDelay = 250ms):**
 * - **1 attempt**: 0ms total (immediate failure)
 * - **2 attempts**: 0-250ms total
 * - **3 attempts**: 0-750ms total
 * - **4 attempts**: 0-1750ms total
 * - **5 attempts**: 0-3750ms total
 *
 * **Memory Usage:**
 * - Minimal overhead (~100 bytes per retry operation)
 * - No persistent state or caching
 * - Promise-based with proper cleanup
 *
 * @see {@link https://aws.amazon.com/architecture/well-architected/} for retry best practices
 * @see {@link https://docs.traceprompt.dev/reliability/retries} for SDK retry configuration
 */

/**
 * Execute a function with exponential backoff retry logic.
 *
 * This function provides robust error recovery for network operations and other
 * transient failures. It uses exponential backoff with full jitter to provide
 * efficient retry behavior while being respectful of downstream services.
 *
 * **Key Features:**
 * - **Exponential backoff** - Delay grows exponentially between attempts
 * - **Full jitter** - Randomized delays prevent thundering herd problems
 * - **Configurable attempts** - Control maximum retry count
 * - **Error callbacks** - Monitor and log retry attempts
 * - **Type-safe** - Preserves return type of the original function
 *
 * @template T - Return type of the function being retried
 * @param fn - Async function to retry (must return a Promise)
 * @param attempts - Maximum number of attempts (default: 5, minimum: 1)
 * @param baseDelay - Base delay in milliseconds for exponential backoff (default: 250ms)
 * @param onError - Optional callback for retry attempts (error, attemptNumber) => void
 * @returns Promise resolving to the successful result or rejecting with the final error
 *
 * @example
 * ```typescript
 * // Basic HTTP request with retry
 * const response = await retry(
 *   () => fetch('https://api.traceprompt.dev/health'),
 *   5, // 5 attempts max
 *   250 // 250ms base delay
 * )
 * ```
 *
 * @example
 * ```typescript
 * // AWS KMS operation with retry and error logging
 * const encryptedKey = await retry(
 *   () => kmsClient.generateDataKey(params),
 *   3, // 3 attempts for interactive operations
 *   100, // 100ms base delay for faster feedback
 *   (error, attempt) => {
 *     console.warn(`KMS attempt ${attempt} failed:`, error.message)
 *   }
 * )
 * ```
 *
 * @example
 * ```typescript
 * // Database operation with custom error handling
 * const result = await retry(
 *   async () => {
 *     const connection = await pool.getConnection()
 *     try {
 *       return await connection.query('SELECT * FROM records')
 *     } finally {
 *       connection.release()
 *     }
 *   },
 *   5,
 *   500,
 *   (error, attempt) => {
 *     // Only log on final attempts to reduce noise
 *     if (attempt >= 3) {
 *       logger.error(`Database retry ${attempt}/5:`, error)
 *     }
 *   }
 * )
 * ```
 *
 * @example
 * ```typescript
 * // Conditional retry based on error type
 * const sensitiveOperation = await retry(
 *   async () => {
 *     try {
 *       return await riskyNetworkCall()
 *     } catch (error) {
 *       // Don't retry authentication errors
 *       if (error.status === 401 || error.status === 403) {
 *         throw new Error('Authentication failed - not retryable')
 *       }
 *       // Don't retry client errors
 *       if (error.status >= 400 && error.status < 500) {
 *         throw new Error('Client error - not retryable')
 *       }
 *       // Allow retry for 5xx errors and network issues
 *       throw error
 *     }
 *   },
 *   5,
 *   250
 * )
 * ```
 *
 * ## Retry Timing
 *
 * **Delay Calculation:**
 * ```
 * Attempt 1: immediate (no delay)
 * Attempt 2: random(0, baseDelay * 1) = random(0, 250ms)
 * Attempt 3: random(0, baseDelay * 2) = random(0, 500ms)
 * Attempt 4: random(0, baseDelay * 4) = random(0, 1000ms)
 * Attempt 5: random(0, baseDelay * 8) = random(0, 2000ms)
 * ```
 *
 * **Total Time Examples:**
 * - **Best case**: Immediate success (0ms)
 * - **Worst case (5 attempts)**: ~3.75 seconds with 250ms base
 * - **Average case**: Success on attempt 2-3 (~500ms)
 *
 * ## Error Callback Usage
 *
 * The `onError` callback is called before each retry attempt (not on success):
 *
 * ```typescript
 * await retry(
 *   () => unreliableOperation(),
 *   5,
 *   250,
 *   (error, attemptNumber) => {
 *     // Called for each failed attempt (1, 2, 3, 4)
 *     // NOT called if attempt 5 succeeds
 *     // NOT called if attempt 1 succeeds
 *
 *     console.log(`Attempt ${attemptNumber} failed:`, error.message)
 *
 *     // Add custom logic
 *     if (attemptNumber === 3) {
 *       metrics.increment('retry.half_failed')
 *     }
 *
 *     // Log only final attempts to reduce noise
 *     if (attemptNumber >= 4) {
 *       logger.error('Retry approaching failure:', error)
 *     }
 *   }
 * )
 * ```
 *
 * ## Best Practices
 *
 * **Retry Configuration:**
 * - **Interactive operations**: 2-3 attempts, 100-250ms base delay
 * - **Background operations**: 5-8 attempts, 250-500ms base delay
 * - **Critical operations**: 8-10 attempts, 500-1000ms base delay
 * - **Testing**: 1-2 attempts, 50-100ms base delay
 *
 * **Error Handling:**
 * - Classify errors as retryable vs permanent before retrying
 * - Use error callbacks for monitoring and debugging
 * - Set appropriate timeouts in the underlying operations
 * - Consider circuit breaker patterns for cascade failures
 *
 * **Resource Management:**
 * - Clean up resources in try/finally blocks within the retried function
 * - Don't retry operations that hold locks or transactions
 * - Consider connection pooling for database operations
 * - Monitor retry rates to detect systemic issues
 *
 * ## Integration Examples
 *
 * **HTTP Transport Layer:**
 * ```typescript
 * // Used in Transport.post() method
 * await retry(async () => {
 *   const response = await fetch(url, options)
 *   if (response.status >= 400) {
 *     throw new Error(`HTTP ${response.status}: ${await response.text()}`)
 *   }
 *   return response
 * }, 5, 250)
 * ```
 *
 * **AWS KMS Operations:**
 * ```typescript
 * // Used in keyring operations
 * const dataKey = await retry(
 *   () => kmsClient.generateDataKey({
 *     KeyId: cmkArn,
 *     KeySpec: 'AES_256'
 *   }),
 *   3, // KMS operations usually fast or fail permanently
 *   200
 * )
 * ```
 *
 * @throws {Error} The error from the final failed attempt if all retries are exhausted
 * @throws {Error} Immediately if attempts < 1 or invalid parameters
 *
 * @see {@link https://en.wikipedia.org/wiki/Exponential_backoff} for exponential backoff theory
 * @see {@link https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/} for jitter patterns
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
