/**
 * @module http-logger
 * @description Batch HTTP transport for Traceprompt SDK with reliability features:
 * - In-memory ring buffer with configurable batch size
 * - Write-ahead logging (WAL) for durability
 * - Automatic retries with exponential backoff
 * - Local file fallback for offline operation
 * - Configurable flush intervals
 *
 * Environment variables:
 * - TP_API_URL: Collector endpoint URL
 * - TP_BATCH_SIZE: Number of entries per batch (default: 50)
 * - TP_FLUSH_INTERVAL_MS: Flush interval in ms (default: 200)
 */

import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import * as wal from "./wal";
import { RingBuffer } from "./ring-buffer";
import { LogEntry } from "./schema/audit-entry";

/** Default collector endpoint from environment */
let url: string | undefined = process.env.TP_API_URL;
/** API key for authentication */
let apiKey: string | undefined;
/** Number of entries to batch before sending */
const batchSize = Number(process.env.TP_BATCH_SIZE ?? 50);
/** Interval between forced flushes in milliseconds */
const flushInterval = Number(process.env.TP_FLUSH_INTERVAL_MS ?? 200);

/** Local log file path for fallback storage */
const LOG_PATH = process.env.TRACE_LOG_PATH ?? path.resolve("trace.log");

// Ensure log directory exists
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

/**
 * Configures the HTTP logger with endpoint and authentication.
 * Must be called before using send().
 *
 * @param {Object} config - Configuration options
 * @param {string} [config.url] - Collector endpoint URL (falls back to TP_API_URL)
 * @param {string} [config.apiKey] - API key for authentication
 * @throws {Error} If URL or API key is missing
 *
 * @example
 * ```typescript
 * configure({
 *   url: 'https://collector.traceprompt.com/logs',
 *   apiKey: 'tp_123...'
 * });
 * ```
 */
export function configure(config: { url?: string; apiKey?: string }) {
  url = config.url ?? url;
  apiKey = config.apiKey ?? apiKey;

  if (!url) {
    throw new Error("[traceprompt] TP_API_URL must be set to use httpLogger");
  }
  if (!apiKey) {
    throw new Error("[traceprompt] API key must be set to use httpLogger");
  }
}

/** Initialize ring buffer and replay WAL */
const ring = new RingBuffer<unknown>(batchSize * 10);
wal.replay().forEach((e) => ring.push(e));
wal.clear();

/**
 * Internal function to append a record to the local log file.
 * Used as fallback when HTTP transport fails.
 */
function appendToFile(record: unknown): void {
  fs.appendFile(LOG_PATH, JSON.stringify(record) + "\n", (err) => {
    /* istanbul ignore next */
    if (err) console.error("[traceprompt] file write error", err);
  });
}

/**
 * Sends a log entry to the collector with batching and reliability guarantees:
 * 1. Appends to Write-Ahead Log (WAL) for durability
 * 2. Pushes to ring buffer for batching
 * 3. Triggers flush if batch size reached
 * 4. Falls back to local file if not configured
 *
 * @param {LogEntry} entry - The log entry to send
 *
 * @example
 * ```typescript
 * send({
 *   ts: new Date().toISOString(),
 *   prompt: '...',
 *   response: '...',
 *   hash: '...',
 *   prevHash: '...'
 * });
 * ```
 */
export function send(entry: LogEntry) {
  console.log("[traceprompt] Logger config:", {
    url,
    apiKey: apiKey ? "[SET]" : "[NOT SET]",
    batchSz: batchSize,
    interval: flushInterval,
  });

  if (!url || !apiKey) {
    appendToFile(entry); // fallback to local file
    return;
  }

  wal.append(entry);
  if (!ring.push(entry)) {
    console.warn("[traceprompt] ring full – overflowing to WAL only");
  }
  if (ring.length >= batchSize) flush();
}

/* Start background flush timer, but don't prevent process exit */
setInterval(() => ring.length && flush(), flushInterval).unref();

/**
 * Internal function to flush buffered entries to the collector.
 * Implements exponential backoff retry logic:
 * - First retry: 500ms
 * - Second retry: 1000ms
 * - Third retry: 2000ms
 * After 3 failed attempts, falls back to local file storage.
 *
 * @param {number} attempt - Current retry attempt (0-3)
 * @returns {Promise<void>}
 */
async function flush(attempt = 0): Promise<void> {
  const batch = ring.popMany(batchSize);
  if (!batch.length) return;

  try {
    await axios.post(url!, batch, {
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      timeout: 5000,
    });
    wal.clear(); // safe to truncate after success
  } catch (err: any) {
    console.error("[traceprompt] HTTP flush failed:", err.message ?? err);
    if (attempt < 3) {
      setTimeout(() => flush(attempt + 1), 500 * 2 ** attempt); // 0.5s,1s,2s
    } else {
      console.error("[traceprompt] giving up – writing batch to file+WAL");
      batch.forEach((e) => {
        appendToFile(e);
        wal.append(e);
      });
    }
  }
}
