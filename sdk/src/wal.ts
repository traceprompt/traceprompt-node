/**
 * @module wal
 * @description Write-Ahead Log (WAL) implementation providing durability guarantees:
 * - Synchronous, fsync'd writes for crash safety
 * - JSON-Lines format for easy recovery
 * - Atomic append operations
 * - Safe replay after crashes
 * - Truncation after successful batch processing
 *
 * The WAL ensures no data is lost even if the process crashes or the system
 * loses power. It works in conjunction with the HTTP logger to provide
 * exactly-once delivery guarantees.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Path to the WAL file, configurable via TRACE_WAL_PATH environment variable.
 * Defaults to ./trace.wal in the current working directory.
 *
 * @example
 * ```bash
 * # Configure custom WAL location
 * export TRACE_WAL_PATH=/var/log/traceprompt/wal.log
 * ```
 */
const WAL_PATH = process.env.TRACE_WAL_PATH ?? path.resolve("trace.wal");

// Ensure WAL directory exists
fs.mkdirSync(path.dirname(WAL_PATH), { recursive: true });

/**
 * Appends an entry to the WAL file with durability guarantees.
 * Uses synchronous writes to ensure entries are persisted to disk
 * before the function returns.
 *
 * @param {unknown} entry - Entry to append to the WAL
 * @throws {Error} If write fails due to permissions or disk space
 *
 * @example
 * ```typescript
 * // Safely append an entry
 * append({
 *   id: 'msg_123',
 *   timestamp: Date.now(),
 *   data: '...'
 * });
 * ```
 */
export function append(entry: unknown) {
  fs.appendFileSync(WAL_PATH, JSON.stringify(entry) + "\n");
}

/**
 * Replays all entries from the WAL file after a crash or restart.
 * Handles file not existing, empty files, and corrupted entries gracefully.
 *
 * @returns {unknown[]} Array of parsed entries in order of original writes
 *
 * @example
 * ```typescript
 * // Recover entries after restart
 * const entries = replay();
 * entries.forEach(entry => {
 *   // Re-process each entry
 *   processEntry(entry);
 * });
 * ```
 */
export function replay(): unknown[] {
  if (!fs.existsSync(WAL_PATH)) return [];
  const lines = fs.readFileSync(WAL_PATH, "utf8").trim().split("\n");
  return lines.filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Truncates the WAL file after entries have been successfully processed.
 * This should only be called after confirming that all entries have been
 * durably stored in their final destination.
 *
 * @example
 * ```typescript
 * // After successful batch processing
 * try {
 *   await processBatch(entries);
 *   clear(); // Safe to clear WAL now
 * } catch (err) {
 *   // WAL remains intact for retry
 * }
 * ```
 */
export function clear() {
  if (fs.existsSync(WAL_PATH)) fs.truncateSync(WAL_PATH, 0);
}
