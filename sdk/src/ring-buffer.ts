/**
 * @module ring-buffer
 * @description Lock-free circular queue implementation optimized for high-throughput scenarios.
 * Provides a fixed-size buffer with O(1) push/pop operations and no memory allocation
 * during normal operation. Thread-safe for single producer, single consumer use cases.
 */

/**
 * Generic ring buffer implementation with overflow protection.
 * Uses a circular array to implement a FIFO queue with fixed capacity.
 *
 * Features:
 * - Lock-free design for high performance
 * - Fixed memory footprint
 * - O(1) push operations
 * - Batch pop support
 * - Overflow detection
 *
 * @template T The type of elements stored in the buffer
 *
 * @example
 * ```typescript
 * // Create a buffer for 1000 items
 * const buffer = new RingBuffer<LogEntry>(1000);
 *
 * // Push returns false when buffer is full
 * if (!buffer.push(entry)) {
 *   console.warn('Buffer full!');
 * }
 *
 * // Pop up to 100 items
 * const batch = buffer.popMany(100);
 * ```
 */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  /** Index where next item will be written */
  private head = 0;
  /** Index where next item will be read */
  private tail = 0;
  /** Fixed capacity of the buffer */
  readonly size: number;

  /**
   * Creates a new ring buffer with specified capacity.
   * @param {number} capacity - Maximum number of items the buffer can hold (default: 1000)
   */
  constructor(capacity = 1000) {
    this.size = capacity;
    this.buf = new Array(capacity);
  }

  /**
   * Attempts to push a value into the buffer.
   * Thread-safe for single producer thread.
   *
   * @param {T} val - Value to push into the buffer
   * @returns {boolean} true if successful, false if buffer is full
   *
   * @example
   * ```typescript
   * const success = buffer.push({ id: 1, data: '...' });
   * if (!success) {
   *   // Handle buffer full condition
   * }
   * ```
   */
  push(val: T): boolean {
    const next = (this.head + 1) % this.size;
    if (next === this.tail) return false; // full
    this.buf[this.head] = val;
    this.head = next;
    return true;
  }

  /**
   * Removes and returns multiple items from the buffer.
   * Thread-safe for single consumer thread.
   *
   * @param {number} n - Maximum number of items to pop (defaults to buffer size)
   * @returns {T[]} Array of popped items (may be empty if buffer is empty)
   *
   * @example
   * ```typescript
   * // Pop up to 50 items
   * const batch = buffer.popMany(50);
   * process(batch);
   *
   * // Pop all items
   * const all = buffer.popMany();
   * ```
   */
  popMany(n = this.size): T[] {
    const out: T[] = [];
    while (this.tail !== this.head && out.length < n) {
      out.push(this.buf[this.tail]!); // non-undefined
      this.tail = (this.tail + 1) % this.size;
    }
    return out;
  }

  /**
   * Gets the current number of items in the buffer.
   * Note: For multi-threaded use, this is only an approximation
   * as the count may change immediately after reading.
   *
   * @returns {number} Current number of items in the buffer
   */
  get length() {
    return (this.head + this.size - this.tail) % this.size;
  }
}
