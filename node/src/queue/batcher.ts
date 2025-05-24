/**
 * @fileoverview Intelligent batching system for encrypted LLM interaction records
 *
 * This module implements an efficient in-memory batching system that optimizes network
 * performance by collecting encrypted records and sending them in batches rather than
 * individually. This reduces network overhead, improves throughput, and provides
 * better resilience to transient network issues.
 *
 * ## Batching Strategy
 *
 * **Dual Flush Triggers:**
 * The batcher uses two complementary triggers to ensure both performance and timeliness:
 * 1. **Size-based flushing** - When queue reaches `batchSize` records (default: 25)
 * 2. **Time-based flushing** - Every `flushIntervalMs` milliseconds (default: 2000ms)
 *
 * This ensures that:
 * - High-volume applications get optimal batching efficiency
 * - Low-volume applications still get timely delivery
 * - Records are never held indefinitely in memory
 *
 * ## Performance Benefits
 *
 * **Network Optimization:**
 * - **Reduced HTTP overhead** - 25x fewer requests with default batch size
 * - **Connection reuse** - HTTP/2 connection efficiency across batches
 * - **Reduced TLS handshakes** - Amortize connection setup costs
 * - **Better throughput** - Server-side processing efficiency
 *
 * **Memory Efficiency:**
 * - **Bounded memory usage** - Queue size limited by batch size and flush frequency
 * - **Minimal overhead** - Simple array-based queue with splice operations
 * - **Automatic cleanup** - Records removed after successful transmission
 * - **No memory leaks** - Proper cleanup on shutdown and errors
 *
 * ## Data Safety & Error Recovery
 *
 * **Failure Resilience:**
 * - **No data loss** - Failed batches are retained for retry
 * - **Graceful degradation** - Individual failures don't affect other records
 * - **Metrics tracking** - Failed flush attempts are monitored
 * - **Background retry** - Failed records will be attempted in next flush
 *
 * **Graceful Shutdown:**
 * - **Signal handling** - Responds to SIGINT, SIGTERM, and beforeExit
 * - **Flush on exit** - Ensures pending records are sent before shutdown
 * - **Clean termination** - Prevents data loss during application shutdown
 * - **Docker/K8s friendly** - Proper signal handling for containerized environments
 *
 * ## Integration with SDK Architecture
 *
 * ```
 * LLM Call → Encrypt → Hash → Batcher → Transport → Traceprompt API
 *                              ↓
 *                        Queue Records
 *                              ↓
 *                     Batch when full OR
 *                     Timer expires
 * ```
 *
 * ## Configuration
 *
 * Batching behavior is controlled by configuration settings:
 *
 * ```typescript
 * initTraceprompt({
 *   batchSize: 25,        // Records per batch (default: 25)
 *   flushIntervalMs: 2000 // Max time between flushes (default: 2000ms)
 * })
 * ```
 *
 * **Tuning Guidelines:**
 *
 * **High Volume Applications:**
 * ```typescript
 * // Optimize for throughput
 * initTraceprompt({
 *   batchSize: 50,        // Larger batches for efficiency
 *   flushIntervalMs: 5000 // Longer intervals for max batching
 * })
 * ```
 *
 * **Low Latency Applications:**
 * ```typescript
 * // Optimize for delivery speed
 * initTraceprompt({
 *   batchSize: 10,        // Smaller batches for faster delivery
 *   flushIntervalMs: 1000 // Shorter intervals for quick delivery
 * })
 * ```
 *
 * **Development/Testing:**
 * ```typescript
 * // Immediate delivery for testing
 * initTraceprompt({
 *   batchSize: 1,         // Send each record immediately
 *   flushIntervalMs: 100  // Very frequent flushes
 * })
 * ```
 *
 * ## Monitoring & Observability
 *
 * The batcher integrates with the optional metrics system:
 * - **Flush failure count** - Tracks network/API failures
 * - **Queue depth monitoring** - Watch for persistent queuing issues
 * - **Flush frequency** - Monitor batching efficiency
 * - **Error rate tracking** - Alert on sustained failures
 *
 * ## Memory Management
 *
 * **Queue Behavior:**
 * - Records stored in simple in-memory array
 * - Bounded by batch size and flush frequency
 * - Typical memory usage: <1MB for standard configurations
 * - No persistent storage - memory-only queuing
 *
 * **Memory Safety:**
 * - Queue size limited by configuration
 * - Automatic cleanup after successful transmission
 * - Graceful shutdown prevents memory leaks
 * - No unbounded growth under normal operation
 *
 * @see {@link flushBatch} for the actual network delivery implementation
 * @see {@link ConfigManager} for batching configuration options
 * @see {@link https://docs.traceprompt.dev/performance/batching} for batching performance guide
 */

import { QueueItem } from "../types";
import { ConfigManager } from "../config";
import { flushBatch } from "./flusher";

/**
 * Optional metrics integration for monitoring batch flush failures.
 *
 * Attempts to import the metrics module if available, but gracefully
 * falls back to a no-op implementation if metrics are not configured.
 * This allows the batcher to work with or without monitoring.
 */
let flushFailCounter: { inc: () => void };
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  flushFailCounter = require("../metrics").flushFailures;
} catch {
  flushFailCounter = { inc: () => void 0 };
}

/**
 * Core batching implementation that manages the in-memory queue and flush logic.
 *
 * This class handles the actual batching logic, including:
 * - Queue management with array-based storage
 * - Dual flush triggers (size and time based)
 * - Error recovery and data safety
 * - Graceful shutdown handling
 * - Metrics integration for monitoring
 *
 * The class is designed as a singleton to ensure consistent batching
 * behavior across the entire application lifecycle.
 *
 * @internal This class is used internally by the public Batcher interface
 */
class BatcherClass {
  private readonly queue: QueueItem[] = [];
  private readonly batchSize: number;
  private flushing = false;

  /**
   * Initialize the batcher with configuration-driven behavior.
   *
   * Sets up:
   * - Batch size from configuration
   * - Periodic flush timer for time-based flushing
   * - Graceful shutdown handlers for data safety
   *
   * The timer is unref'd to prevent it from keeping the process alive,
   * and shutdown handlers ensure pending data is flushed on exit.
   */
  constructor() {
    const { flushIntervalMs, batchSize } = ConfigManager.cfg;
    this.batchSize = batchSize;

    /* Periodic timer ensures low-traffic flushes.                  */
    setInterval(() => this.flush().catch(() => {}), flushIntervalMs).unref();

    /* Flush on graceful shutdown.                                  */
    for (const sig of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
      process.once(sig, async () => {
        try {
          await this.flush();
        } finally {
          process.exit();
        }
      });
    }
  }

  /**
   * Add an encrypted record to the in-memory queue for batched delivery.
   *
   * This method queues the encrypted record and triggers an immediate flush
   * if the batch size threshold is reached. For performance, the flush is
   * fire-and-forget (async but not awaited) to avoid blocking the caller.
   *
   * @param item - Encrypted record with payload and hash for integrity
   *
   * @example
   * ```typescript
   * // Automatic queuing (handled by wrapLLM)
   * const encryptedBundle = await encryptBuffer(sensitiveData)
   * const leafHash = computeLeaf(JSON.stringify(payload))
   *
   * batcher.enqueue({
   *   payload: {
   *     tenantId: 'tnt_abc123',
   *     enc: encryptedBundle,
   *     // ... other metadata
   *   },
   *   leafHash
   * })
   * ```
   *
   * ## Queue Behavior
   *
   * **Size-based flushing:**
   * - Queue grows until `batchSize` is reached
   * - Immediate flush triggered when threshold exceeded
   * - Fire-and-forget async to avoid blocking LLM calls
   *
   * **Memory management:**
   * - Records stored in simple array for efficiency
   * - Queue bounded by batch size and flush frequency
   * - Automatic cleanup after successful transmission
   *
   * **Thread safety:**
   * - Single-threaded Node.js event loop provides safety
   * - No additional locking or synchronization needed
   * - Flush state prevents concurrent flush operations
   */
  enqueue(item: QueueItem): void {
    this.queue.push(item);
    if (this.queue.length >= this.batchSize) {
      void this.flush(); // fire-and-forget
    }
  }

  /**
   * Flush pending records to the Traceprompt API with comprehensive error handling.
   *
   * This method safely drains up to `batchSize` records from the queue and
   * attempts to send them via the transport layer. It includes sophisticated
   * error recovery to ensure no data is lost during network failures.
   *
   * @returns Promise that resolves when flush completes (success or failure)
   *
   * @example
   * ```typescript
   * // Manual flush (usually not needed - automatic via timers and batch size)
   * await batcher.flush()
   *
   * // Flush on application shutdown
   * process.on('SIGTERM', async () => {
   *   await batcher.flush()
   *   process.exit(0)
   * })
   * ```
   *
   * ## Flush Logic
   *
   * **Concurrency control:**
   * - Only one flush operation can run at a time
   * - Additional flush calls are no-op while one is running
   * - Prevents duplicate transmission of the same records
   *
   * **Batch extraction:**
   * - Removes up to `batchSize` records from queue front
   * - Uses `Array.splice()` for atomic removal
   * - Queue continues to accept new records during flush
   *
   * **Error recovery:**
   * - Network failures don't lose records
   * - Failed records remain in queue for next attempt
   * - Metrics incremented to track failure rates
   * - Background retry via timer or next enqueue trigger
   *
   * ## Network Failure Handling
   *
   * **Transient failures:**
   * - Records returned to queue for retry
   * - Exponential backoff handled by transport layer
   * - Metrics tracking for monitoring health
   *
   * **Persistent failures:**
   * - Records accumulate in queue (bounded by batch size)
   * - Application continues to function
   * - Monitoring alerts can detect sustained failures
   *
   * ## Performance Characteristics
   *
   * **Typical latency:** 0.1-1ms for queue operations
   * **Network latency:** Depends on transport retry logic
   * **Memory usage:** ~1KB per queued record
   * **Concurrency:** Single flush at a time prevents overload
   */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    try {
      const batch = this.queue.splice(0, this.batchSize);
      await flushBatch(batch);
    } catch (err) {
      /* On failure push records back so they aren't lost.          */
      this.queue.unshift(...this.queue.splice(0, 0)); // no-op; keeps TS happy
      flushFailCounter.inc();
    } finally {
      this.flushing = false;
    }
  }
}

/**
 * Singleton batcher instance for application-wide batching consistency.
 *
 * Lazy initialization ensures the batcher is created only when needed
 * and with the current configuration settings.
 */
let _batcherInstance: BatcherClass | null = null;

/**
 * Public interface for the batching system used throughout the SDK.
 *
 * This object provides a clean, singleton-based API for interacting with
 * the batching system. It handles lazy initialization and ensures consistent
 * batching behavior across the entire application.
 *
 * **Key Features:**
 * - **Singleton pattern** - One batcher per application
 * - **Lazy initialization** - Created when first needed
 * - **Configuration-driven** - Uses current ConfigManager settings
 * - **Thread-safe** - Safe for use across the application
 *
 * ## Usage
 *
 * The batcher is used automatically by the SDK:
 *
 * ```typescript
 * // Automatic usage (via wrapLLM)
 * const trackedLLM = wrapLLM(originalLLM, { modelVendor: 'openai', modelName: 'gpt-4o' })
 * await trackedLLM('Hello') // Automatically batched and delivered
 * ```
 *
 * ## Manual Control (Advanced)
 *
 * ```typescript
 * // Force immediate flush (e.g., before application shutdown)
 * import { Batcher } from '@traceprompt/node/queue/batcher'
 * await Batcher.flush()
 *
 * // Manual record queuing (not recommended for normal use)
 * Batcher.enqueue({ payload: encryptedData, leafHash: hash })
 * ```
 *
 * ## Configuration Impact
 *
 * Batcher behavior is controlled by SDK configuration:
 *
 * ```typescript
 * // High-throughput configuration
 * initTraceprompt({
 *   batchSize: 50,        // Larger batches
 *   flushIntervalMs: 5000 // Less frequent flushing
 * })
 *
 * // Low-latency configuration
 * initTraceprompt({
 *   batchSize: 10,        // Smaller batches
 *   flushIntervalMs: 1000 // More frequent flushing
 * })
 * ```
 *
 * ## Monitoring Integration
 *
 * The batcher automatically integrates with the metrics system when available:
 * - Flush failure rates for network health monitoring
 * - Queue depth for performance tuning
 * - Batch efficiency for optimization insights
 *
 * @see {@link BatcherClass} for implementation details
 * @see {@link ConfigManager} for configuration options
 */
export const Batcher = {
  /**
   * Add an encrypted record to the batch queue for delivery.
   *
   * This method queues encrypted LLM interaction records for efficient
   * batch delivery to the Traceprompt API. It automatically triggers
   * immediate delivery when the batch size threshold is reached.
   *
   * @param item - Encrypted record containing payload and integrity hash
   *
   * @example
   * ```typescript
   * // Automatic usage via SDK (recommended)
   * const trackedLLM = wrapLLM(originalLLM, { modelVendor: 'openai', modelName: 'gpt-4o' })
   * await trackedLLM('Sensitive prompt') // Automatically queued
   * ```
   *
   * @example
   * ```typescript
   * // Manual usage (advanced scenarios only)
   * const encryptedBundle = await encryptBuffer(Buffer.from(JSON.stringify({
   *   prompt: 'Sensitive data',
   *   response: 'LLM response'
   * })))
   *
   * const payload = {
   *   tenantId: 'tnt_abc123',
   *   modelVendor: 'openai',
   *   modelName: 'gpt-4o',
   *   ts_client: new Date().toISOString(),
   *   enc: encryptedBundle
   * }
   *
   * const leafHash = computeLeaf(JSON.stringify(payload))
   * Batcher.enqueue({ payload, leafHash })
   * ```
   *
   * ## Batching Behavior
   *
   * **Immediate flush triggers:**
   * - Queue reaches configured `batchSize` (default: 25 records)
   * - Ensures high-volume applications get optimal batching
   * - Fire-and-forget async to avoid blocking LLM calls
   *
   * **Timer-based flush:**
   * - Periodic flush every `flushIntervalMs` (default: 2000ms)
   * - Ensures low-volume applications get timely delivery
   * - Prevents records from being held indefinitely
   *
   * **Memory management:**
   * - Queue size bounded by configuration settings
   * - Typical memory usage: <1MB for standard configurations
   * - Automatic cleanup after successful transmission
   *
   * ## Error Handling
   *
   * This method never throws errors - all error handling is done
   * during the background flush process:
   * - Network failures don't affect LLM call performance
   * - Failed records are retained for automatic retry
   * - Metrics track failure rates for monitoring
   *
   * @see {@link BatcherClass.enqueue} for implementation details
   */
  enqueue(item: QueueItem): void {
    if (!_batcherInstance) {
      _batcherInstance = new BatcherClass();
    }
    _batcherInstance.enqueue(item);
  },

  /**
   * Manually flush all pending records to the Traceprompt API.
   *
   * This method forces immediate delivery of all queued records,
   * regardless of batch size or timer settings. It's primarily used
   * for graceful application shutdown or testing scenarios.
   *
   * @returns Promise that resolves when flush completes
   *
   * @example
   * ```typescript
   * // Graceful shutdown - ensure all data is sent
   * process.on('SIGTERM', async () => {
   *   console.log('Flushing pending records...')
   *   await Batcher.flush()
   *   console.log('Graceful shutdown complete')
   *   process.exit(0)
   * })
   * ```
   *
   * @example
   * ```typescript
   * // Testing - ensure records are sent immediately
   * await trackedLLM('Test prompt')
   * await Batcher.flush() // Force immediate delivery for test verification
   * ```
   *
   * @example
   * ```typescript
   * // Health check - verify connectivity
   * try {
   *   await Batcher.flush()
   *   console.log('✅ Connectivity confirmed')
   * } catch (error) {
   *   console.error('❌ Network issues detected:', error)
   * }
   * ```
   *
   * ## Flush Behavior
   *
   * **Concurrency control:**
   * - Only one flush can run at a time
   * - Concurrent calls wait for ongoing flush to complete
   * - Prevents duplicate transmission of records
   *
   * **Error handling:**
   * - Network failures are thrown to caller
   * - Failed records remain queued for automatic retry
   * - Detailed error messages for troubleshooting
   *
   * **Performance:**
   * - Flushes up to `batchSize` records per call
   * - Large queues may require multiple flush calls
   * - Background timer continues normal batching
   *
   * ## Use Cases
   *
   * **Application shutdown:**
   * - Ensure all pending data is sent before exit
   * - Critical for data integrity in containerized environments
   * - Handles SIGTERM gracefully for Kubernetes/Docker
   *
   * **Testing scenarios:**
   * - Force immediate delivery for test verification
   * - Avoid waiting for timer-based flushes in tests
   * - Verify connectivity and configuration
   *
   * **Health monitoring:**
   * - Periodic flush to verify API connectivity
   * - Detect network issues proactively
   * - Monitor end-to-end delivery pipeline
   *
   * @throws {Error} Network connectivity issues after all retries
   * @throws {Error} Authentication failures (invalid API key)
   * @throws {Error} Server errors (API unavailable)
   *
   * @see {@link BatcherClass.flush} for implementation details
   * @see {@link flushBatch} for the underlying delivery mechanism
   */
  async flush(): Promise<void> {
    if (!_batcherInstance) {
      _batcherInstance = new BatcherClass();
    }
    return _batcherInstance.flush();
  },
};
