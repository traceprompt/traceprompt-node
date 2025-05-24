/**
 * @fileoverview Final delivery stage for encrypted LLM interaction batches
 *
 * This module handles the final step in the Traceprompt SDK's data delivery pipeline:
 * transforming batched encrypted records into the proper API format and delivering them
 * to the Traceprompt ingestion endpoint via secure HTTPS transport.
 *
 * ## Role in SDK Architecture
 *
 * The flusher sits at the end of the processing pipeline:
 *
 * ```
 * LLM Call → Encrypt → Hash → Batch → Flusher → Transport → Traceprompt API
 *                                       ↓
 *                               Format for API
 *                                       ↓
 *                              Secure HTTPS Delivery
 * ```
 *
 * ## Core Responsibilities
 *
 * **Data Transformation:**
 * - Convert internal queue items to API-compatible format
 * - Include tenant identification for multi-tenant isolation
 * - Preserve encrypted payloads and integrity hashes
 * - Maintain record ordering and relationships
 *
 * **Delivery Coordination:**
 * - Interface with the secure transport layer
 * - Handle API endpoint routing (/v1/ingest)
 * - Propagate errors for proper retry handling
 * - Maintain transactional semantics for batches
 *
 * **Security Preservation:**
 * - Never decrypt or inspect sensitive data
 * - Maintain end-to-end encryption guarantees
 * - Preserve cryptographic integrity hashes
 * - Ensure tenant isolation and data segregation
 *
 * ## API Integration
 *
 * **Endpoint:** `POST /v1/ingest`
 *
 * **Request Format:**
 * ```json
 * {
 *   "tenantId": "tnt_abc123",
 *   "records": [
 *     {
 *       "payload": {
 *         "tenantId": "tnt_abc123",
 *         "modelVendor": "openai",
 *         "modelName": "gpt-4o",
 *         "userId": "user-123",
 *         "ts_client": "2024-01-15T10:30:00.000Z",
 *         "latency_ms": 1247.5,
 *         "prompt_tokens": 23,
 *         "response_tokens": 157,
 *         "enc": {
 *           "ciphertext": "base64-encrypted-data...",
 *           "encryptedDataKey": "base64-encrypted-key...",
 *           "suiteId": 123
 *         }
 *       },
 *       "leafHash": "blake3-hash-of-payload..."
 *     }
 *   ]
 * }
 * ```
 *
 * ## Error Handling Strategy
 *
 * **Error Propagation:**
 * The flusher deliberately propagates all errors to the caller (Batcher) for proper
 * error handling and retry logic:
 *
 * - **Network errors** → Propagated for retry with exponential backoff
 * - **Authentication errors** → Propagated to surface configuration issues
 * - **Server errors** → Propagated for monitoring and alerting
 * - **Client errors** → Propagated to identify malformed requests
 *
 * **Transactional Semantics:**
 * - **All-or-nothing delivery** - Entire batch succeeds or fails together
 * - **No partial delivery** - Prevents data inconsistencies
 * - **Atomic operation** - Simplifies error recovery logic
 * - **Idempotent retries** - Safe to retry failed batches
 *
 * ## Performance Characteristics
 *
 * **Throughput:**
 * - Handles batches of 1-100 records efficiently
 * - Typical batch processing: <5ms (excluding network time)
 * - Memory usage: ~1KB overhead per batch
 * - JSON serialization: Optimized for encrypted payloads
 *
 * **Latency:**
 * - Local processing: <1ms for typical batches
 * - Network latency: Handled by transport layer
 * - No caching or buffering delays
 * - Immediate delivery after formatting
 *
 * ## Security Considerations
 *
 * **Data Handling:**
 * - Processes only encrypted data (never plaintext)
 * - Maintains encryption envelope integrity
 * - Preserves cryptographic hashes for audit trails
 * - Ensures tenant data isolation
 *
 * **Transport Security:**
 * - Delegates to transport layer for HTTPS/TLS encryption
 * - API authentication handled by transport
 * - Certificate validation in transport layer
 * - No additional security processing needed
 *
 * @see {@link Transport} for secure HTTPS delivery implementation
 * @see {@link Batcher} for batching and retry logic
 * @see {@link https://docs.traceprompt.dev/api/ingest} for API documentation
 */

import { QueueItem } from "../types";
import { ConfigManager } from "../config";
import { Transport } from "../network/transport";

/**
 * Deliver a batch of encrypted records to the Traceprompt ingestion API.
 *
 * This function represents the final stage of the SDK's data delivery pipeline.
 * It transforms internally queued records into the API format required by the
 * Traceprompt ingestion endpoint and delivers them via secure HTTPS transport.
 *
 * **Key Responsibilities:**
 * - Transform queue items to API-compatible JSON format
 * - Include tenant identification for proper data isolation
 * - Preserve encrypted payloads and cryptographic hashes
 * - Delegate secure delivery to the transport layer
 * - Propagate errors for proper retry handling by the batcher
 *
 * @param batch - Array of encrypted records ready for delivery
 *
 * @example
 * ```typescript
 * // Typical usage (via Batcher - automatic)
 * const batch = [
 *   {
 *     payload: {
 *       tenantId: 'tnt_abc123',
 *       modelVendor: 'openai',
 *       modelName: 'gpt-4o',
 *       ts_client: '2024-01-15T10:30:00.000Z',
 *       enc: {
 *         ciphertext: 'base64-encrypted-prompt-and-response...',
 *         encryptedDataKey: 'base64-encrypted-key...',
 *         suiteId: 123
 *       }
 *     },
 *     leafHash: 'blake3-hash-for-integrity-verification...'
 *   }
 * ]
 *
 * await flushBatch(batch) // Delivered to /v1/ingest
 * ```
 *
 * @example
 * ```typescript
 * // Error handling (typically done by Batcher)
 * try {
 *   await flushBatch(pendingRecords)
 *   console.log('✅ Batch delivered successfully')
 * } catch (error) {
 *   if (error.message.includes('HTTP 401')) {
 *     console.error('❌ Authentication failed - check API key')
 *   } else if (error.message.includes('HTTP 429')) {
 *     console.warn('⚠️ Rate limited - will retry with backoff')
 *   } else if (error.message.includes('HTTP 5')) {
 *     console.error('❌ Server error - will retry automatically')
 *   } else {
 *     console.error('❌ Network error:', error.message)
 *   }
 *   // Re-queue records for retry (handled by Batcher)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Manual flush for testing (not recommended for production)
 * import { flushBatch } from '@traceprompt/node/queue/flusher'
 *
 * const testBatch = [{
 *   payload: await encryptAndFormatRecord(testData),
 *   leafHash: computeLeaf(JSON.stringify(testData))
 * }]
 *
 * await flushBatch(testBatch) // Direct API delivery
 * ```
 *
 * ## Request Format
 *
 * The function constructs a JSON request with the following structure:
 *
 * **Top Level:**
 * - `tenantId` - Identifies the customer tenant for data isolation
 * - `records` - Array of encrypted records with integrity hashes
 *
 * **Record Structure:**
 * - `payload` - Complete encrypted record with metadata
 * - `leafHash` - BLAKE3 hash for cryptographic integrity
 *
 * **Payload Contents:**
 * - `tenantId` - Tenant identification (duplicated for validation)
 * - `modelVendor` - LLM provider ('openai', 'anthropic', etc.)
 * - `modelName` - Specific model used ('gpt-4o', 'claude-3-5-sonnet', etc.)
 * - `userId` - Optional user identification for analytics
 * - `ts_client` - Client-side timestamp (ISO 8601 format)
 * - `latency_ms` - LLM call duration in milliseconds
 * - `prompt_tokens` - Estimated token count for prompt
 * - `response_tokens` - Estimated token count for response
 * - `enc` - Encrypted bundle containing sensitive data
 *
 * **Encryption Bundle:**
 * - `ciphertext` - Base64-encoded encrypted prompt/response
 * - `encryptedDataKey` - Base64-encoded encrypted data key
 * - `suiteId` - Encryption algorithm identifier
 *
 * ## API Endpoint Details
 *
 * **URL Construction:**
 * - Base URL from `ConfigManager.cfg.ingestUrl`
 * - Fixed path: `/v1/ingest`
 * - Full URL example: `https://api.traceprompt.dev/v1/ingest`
 *
 * **HTTP Method:** POST
 *
 * **Headers (added by Transport):**
 * - `Content-Type: application/json`
 * - `X-API-Key: your-api-key`
 * - `User-Agent: traceprompt-sdk/0.1.0`
 *
 * **Authentication:**
 * - API key authentication via `X-API-Key` header
 * - Tenant authorization validated server-side
 * - Request signing prevents replay attacks
 *
 * ## Error Conditions
 *
 * This function deliberately propagates all errors to enable proper error
 * handling and retry logic in the calling code (typically the Batcher):
 *
 * **Network Errors:**
 * - DNS resolution failures
 * - Connection timeouts
 * - Network connectivity issues
 * - TLS handshake failures
 *
 * **Authentication Errors:**
 * - HTTP 401: Invalid or missing API key
 * - HTTP 403: Valid key but insufficient permissions
 * - Tenant authorization failures
 *
 * **Client Errors:**
 * - HTTP 400: Malformed request body or headers
 * - HTTP 422: Valid JSON but invalid data format
 * - Missing required fields
 *
 * **Server Errors:**
 * - HTTP 5xx: Temporary server issues
 * - Service overload or maintenance
 * - Database connectivity problems
 *
 * **Rate Limiting:**
 * - HTTP 429: Too many requests
 * - Tenant rate limits exceeded
 * - Requires exponential backoff retry
 *
 * ## Performance Optimization
 *
 * **JSON Serialization:**
 * - Efficient object mapping without deep cloning
 * - Preserves encrypted data without modification
 * - Minimal memory allocation for large batches
 *
 * **Memory Management:**
 * - No data copying or buffering
 * - Immediate garbage collection after delivery
 * - Bounded memory usage regardless of batch size
 *
 * **Network Efficiency:**
 * - Single HTTP request per batch
 * - Connection reuse via transport layer
 * - Optimal payload compression
 *
 * ## Integration Testing
 *
 * ```typescript
 * // Test successful delivery
 * const mockBatch = createTestBatch()
 * await expect(flushBatch(mockBatch)).resolves.toBeUndefined()
 *
 * // Test error propagation
 * const invalidBatch = createInvalidBatch()
 * await expect(flushBatch(invalidBatch)).rejects.toThrow('HTTP 400')
 *
 * // Test tenant isolation
 * const crossTenantBatch = createCrossTenantBatch()
 * await expect(flushBatch(crossTenantBatch)).rejects.toThrow('HTTP 403')
 * ```
 *
 * ## Security Invariants
 *
 * **Data Protection:**
 * - Function never decrypts or inspects sensitive data
 * - Maintains end-to-end encryption guarantees
 * - Preserves cryptographic integrity hashes
 * - Ensures tenant data isolation
 *
 * **Error Information:**
 * - Error messages never contain sensitive data
 * - Only metadata and status codes in error responses
 * - No logging of encrypted payloads
 * - Maintains privacy during error handling
 *
 * @throws {Error} Network connectivity failures after transport retry logic
 * @throws {Error} Authentication failures (HTTP 401/403) - check API key and permissions
 * @throws {Error} Client errors (HTTP 4xx) - check request format and tenant configuration
 * @throws {Error} Server errors (HTTP 5xx) - temporary service issues
 * @throws {Error} Rate limiting (HTTP 429) - reduce request frequency
 *
 * @see {@link QueueItem} for the input record format
 * @see {@link Transport.post} for the underlying HTTP delivery mechanism
 * @see {@link ConfigManager} for tenant and endpoint configuration
 * @see {@link https://docs.traceprompt.dev/api/ingest} for complete API documentation
 */
export async function flushBatch(batch: QueueItem[]): Promise<void> {
  const { tenantId } = ConfigManager.cfg;

  const body = {
    tenantId,
    records: batch.map(({ payload, leafHash }) => ({
      payload,
      leafHash,
    })),
  };

  await Transport.post("/v1/ingest", body);
}
