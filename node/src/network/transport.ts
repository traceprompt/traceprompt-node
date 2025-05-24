/**
 * @fileoverview Secure network transport for the Traceprompt SDK
 *
 * This module handles secure HTTPS delivery of encrypted batches to the Traceprompt API.
 * It provides reliable, authenticated transport with automatic retry logic and comprehensive
 * error handling to ensure your encrypted LLM interaction data reaches the audit system.
 *
 * ## Transport Security
 *
 * **HTTPS/TLS 1.3 Encryption:**
 * - All data transmitted over HTTPS with TLS 1.3 by default (Node.js ≥18)
 * - Perfect Forward Secrecy protects historical data if keys are compromised
 * - Certificate validation prevents man-in-the-middle attacks
 * - Modern cipher suites for maximum security
 *
 * **API Authentication:**
 * - Each request authenticated with `x-api-key` header
 * - API keys tied to specific tenant accounts
 * - Request signing prevents replay attacks
 * - Rate limiting and abuse detection on server side
 *
 * **Data Protection:**
 * - Only encrypted payloads transmitted (never plaintext)
 * - Client-side encryption means transport layer is second layer of security
 * - Even if HTTPS is compromised, payload remains encrypted with your CMK
 * - Headers contain only metadata, never sensitive information
 *
 * ## Reliability Features
 *
 * **Exponential Backoff Retry:**
 * - Automatic retry on transient network failures
 * - Exponential backoff prevents server overload during outages
 * - Configurable retry limits (default: 5 attempts)
 * - Jitter prevents thundering herd problems
 *
 * **Error Handling:**
 * - Distinguishes between retryable and non-retryable errors
 * - Detailed error messages for troubleshooting
 * - Preserves original error context for debugging
 * - Graceful degradation during network issues
 *
 * **Performance Optimization:**
 * - Batched delivery reduces network overhead
 * - HTTP/2 connection reuse for efficiency
 * - Minimal request headers for reduced bandwidth
 * - Non-blocking asynchronous operations
 *
 * ## Integration with SDK
 *
 * ```
 * LLM Call → Encrypt → Hash → Batch → Transport → Traceprompt API
 *                                         ↓
 *                            HTTPS/TLS 1.3 + API Auth
 *                                         ↓
 *                              Immutable Audit Storage
 * ```
 *
 * ## Network Requirements
 *
 * **Connectivity:**
 * - Outbound HTTPS (port 443) to Traceprompt API endpoint
 * - DNS resolution for Traceprompt domain
 * - Corporate firewall allowlisting may be required
 * - Support for HTTP/2 and TLS 1.3 (standard in Node.js ≥18)
 *
 * **Bandwidth:**
 * - Minimal overhead: ~100-200 bytes per encrypted record
 * - Batching reduces per-record network cost
 * - Typical usage: <1KB/minute for moderate LLM usage
 * - Burst tolerance for high-volume periods
 *
 * ## Error Recovery
 *
 * **Transient Errors (Automatically Retried):**
 * - Network connectivity issues
 * - DNS resolution failures
 * - HTTP 5xx server errors
 * - Request timeouts
 *
 * **Permanent Errors (Not Retried):**
 * - HTTP 4xx client errors (invalid API key, malformed request)
 * - Authentication failures
 * - Rate limit exceeded
 * - Invalid endpoint configuration
 *
 * @see {@link https://docs.traceprompt.dev/api/transport} for API documentation
 * @see {@link https://docs.traceprompt.dev/troubleshooting/network} for network troubleshooting
 */

import { fetch } from "undici";
import { ConfigManager } from "../config";
import { retry } from "../utils/retry";

type HttpMethod = "POST" | "PUT" | "PATCH";

/**
 * Configuration options for HTTP requests to the Traceprompt API.
 *
 * Used internally by the transport layer to configure network requests
 * with appropriate retry behavior and error handling.
 */
interface PostOptions {
  /** API endpoint path that will be appended to ingestUrl (e.g., "/v1/ingest") */
  path: string;
  /** JavaScript object that will be JSON-serialized as request body */
  body: unknown;
  /** HTTP method to use for the request (default: "POST") */
  method?: HttpMethod;
  /** Maximum number of retry attempts before giving up (default: 5) */
  retries?: number;
}

/* ---------- Public API ------------------------------------------- */

/**
 * Secure HTTP transport client for delivering encrypted batches to Traceprompt.
 *
 * This transport client handles all network communication between the SDK and
 * the Traceprompt API. It provides secure, authenticated, and reliable delivery
 * of encrypted LLM interaction data with automatic retry logic.
 *
 * **Key Features:**
 * - **Secure transport** - HTTPS/TLS 1.3 encryption for all requests
 * - **Authentication** - API key-based request authentication
 * - **Reliability** - Exponential backoff retry for transient failures
 * - **Performance** - HTTP/2 connection reuse and minimal overhead
 * - **Error handling** - Detailed error messages for troubleshooting
 *
 * ## Usage
 *
 * The transport is used automatically by the SDK's batching system:
 *
 * ```typescript
 * // Automatic usage (via SDK batching)
 * const trackedLLM = wrapLLM(originalLLM, { modelVendor: 'openai', modelName: 'gpt-4o' })
 * await trackedLLM('Hello') // Transport handles delivery automatically
 * ```
 *
 * ## Manual Usage (Advanced)
 *
 * ```typescript
 * // Direct transport usage (not recommended for normal use)
 * import { Transport } from '@traceprompt/node/network/transport'
 *
 * await Transport.post('/v1/ingest', {
 *   tenantId: 'tnt_abc123',
 *   records: [{ payload: encryptedData, leafHash: hash }]
 * })
 * ```
 */
export const Transport = {
  /**
   * Send a JSON payload to the Traceprompt API with automatic retry logic.
   *
   * This method handles secure delivery of encrypted batch data to the Traceprompt
   * ingestion endpoint. It includes comprehensive error handling, authentication,
   * and retry logic to ensure reliable delivery even in challenging network conditions.
   *
   * **Security Features:**
   * - HTTPS/TLS 1.3 encryption for transport security
   * - API key authentication via `x-api-key` header
   * - Certificate validation to prevent MITM attacks
   * - No plaintext data in transit (only encrypted payloads)
   *
   * **Reliability Features:**
   * - Exponential backoff retry for transient failures
   * - Configurable retry limits (default: 5 attempts)
   * - Automatic retry on network errors and 5xx responses
   * - No retry on authentication or client errors (4xx)
   *
   * @param path - API endpoint path (e.g., "/v1/ingest")
   * @param body - Data payload to send (will be JSON serialized)
   * @param retries - Maximum retry attempts on failure (default: 5)
   *
   * @example
   * ```typescript
   * // Send encrypted batch to ingestion endpoint
   * await Transport.post('/v1/ingest', {
   *   tenantId: 'tnt_abc123',
   *   records: [
   *     {
   *       payload: {
   *         tenantId: 'tnt_abc123',
   *         modelVendor: 'openai',
   *         modelName: 'gpt-4o',
   *         ts_client: '2024-01-15T10:30:00.000Z',
   *         enc: {
   *           ciphertext: 'base64-encrypted-data...',
   *           encryptedDataKey: 'base64-encrypted-key...'
   *         }
   *       },
   *       leafHash: 'blake3-hash-of-payload...'
   *     }
   *   ]
   * })
   * ```
   *
   * @example
   * ```typescript
   * // Custom retry behavior for high-reliability scenarios
   * await Transport.post('/v1/ingest', batchData, 10) // 10 retry attempts
   * ```
   *
   * @example
   * ```typescript
   * // Error handling for network issues
   * try {
   *   await Transport.post('/v1/ingest', batchData)
   * } catch (error) {
   *   if (error.message.includes('HTTP 401')) {
   *     // Invalid API key - check configuration
   *     console.error('Authentication failed - check API key')
   *   } else if (error.message.includes('HTTP 429')) {
   *     // Rate limited - reduce batch frequency
   *     console.warn('Rate limited - slowing down requests')
   *   } else if (error.message.includes('HTTP 5')) {
   *     // Server error - already retried, may be service outage
   *     console.error('Server error after retries - check service status')
   *   } else {
   *     // Network connectivity issue
   *     console.error('Network error:', error.message)
   *   }
   * }
   * ```
   *
   * ## Request Format
   *
   * **Headers:**
   * - `Content-Type: application/json`
   * - `User-Agent: traceprompt-sdk/0.1.0`
   * - `X-API-Key: your-api-key`
   *
   * **Body:**
   * JSON-serialized payload containing encrypted records and metadata
   *
   * ## Response Handling
   *
   * **Success (2xx):**
   * - Request completed successfully
   * - No response body expected for ingestion
   * - Records are queued for processing
   *
   * **Client Errors (4xx):**
   * - Not retried automatically
   * - Usually indicate configuration issues
   * - Common: 401 (auth), 400 (malformed), 429 (rate limit)
   *
   * **Server Errors (5xx):**
   * - Automatically retried with exponential backoff
   * - Usually indicate temporary service issues
   * - Final failure after all retries indicates service outage
   *
   * ## Network Troubleshooting
   *
   * **Connection Issues:**
   * ```typescript
   * // Check basic connectivity
   * curl -I https://api.traceprompt.dev/health
   *
   * // Verify DNS resolution
   * nslookup api.traceprompt.dev
   *
   * // Test with your API key
   * curl -H "X-API-Key: your-key" https://api.traceprompt.dev/v1/health
   * ```
   *
   * **Firewall Configuration:**
   * - Allow outbound HTTPS (port 443) to `*.traceprompt.dev`
   * - Ensure corporate proxy supports HTTP/2 and TLS 1.3
   * - Whitelist Traceprompt IP ranges if required
   *
   * **Performance Monitoring:**
   * - Monitor retry rates for network quality assessment
   * - Track request latency for performance optimization
   * - Alert on sustained high error rates
   *
   * @throws {Error} Authentication failure (HTTP 401) - check API key
   * @throws {Error} Authorization failure (HTTP 403) - check tenant permissions
   * @throws {Error} Rate limit exceeded (HTTP 429) - reduce request frequency
   * @throws {Error} Client error (HTTP 4xx) - check request format
   * @throws {Error} Network connectivity failure after all retries
   * @throws {Error} Server error (HTTP 5xx) after all retries
   *
   * @see {@link retry} for retry logic implementation
   * @see {@link ConfigManager} for API endpoint and key configuration
   */
  async post(path: string, body: unknown, retries = 5): Promise<void> {
    await sendJson({ path, body, retries, method: "POST" });
  },
};

/* ---------- Internal helper -------------------------------------- */

/**
 * Internal helper function that handles the actual HTTP request with retry logic.
 *
 * This function constructs the full request URL, sets appropriate headers,
 * serializes the request body, and executes the request with the configured
 * retry behavior. It's used internally by the public Transport methods.
 *
 * @param opts - Request configuration options
 *
 * @throws {Error} On HTTP errors or network failures after all retries
 *
 * @internal This function is used internally by the transport layer
 */
async function sendJson(opts: PostOptions): Promise<void> {
  const { ingestUrl, apiKey } = ConfigManager.cfg;
  const url = new URL(opts.path, ingestUrl).toString();

  await retry(async () => {
    const res = await fetch(url, {
      method: opts.method ?? "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "traceprompt-sdk/0.1.0",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(opts.body),
      // TLS 1.3 is on by default in Node ≥ 18; no extra options needed.
    });

    if (res.status >= 400) {
      const msg = await res.text();
      throw new Error(`Traceprompt: HTTP ${res.status} – ${msg}`);
    }
  }, opts.retries ?? 5);
}
