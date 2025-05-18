/* ------------------------------------------------------------------
 * buffer.ts  •  In-process ring buffer + WAL + flush scheduler
 * ------------------------------------------------------------------
 * 1. enqueue() = O(1) lock-free push
 * 2. spill to WAL if buffer is full
 * 3. flusher thread wakes every flushIntervalMs, drains up to batchSize
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { BatchPayload, LogEntry } from "./types";
import { settings } from "./state";

/* ---------- 1. Ring-buffer helpers -------------------------------- */

const { batchSize } = settings;

/** Fixed-size circular buffer */
const buf: Array<LogEntry | undefined> = new Array(batchSize);
let head = 0; // next write slot
let tail = 0; // next flush slot

/** Push entry; returns false if overflowed */
export function enqueue(entry: LogEntry): boolean {
  buf[head] = entry;
  head = (head + 1) % batchSize;

  // buffer full → overwrite risk → spill to WAL
  if (head === tail) {
    spillToWal(buf[tail]!);
    tail = (tail + 1) % batchSize;
    return false;
  }
  return true;
}

/* ---------- 2. Write-ahead log on overflow ------------------------ */

function spillToWal(e: LogEntry) {
  if (!settings.walPath) return;
  fs.appendFile(settings.walPath, JSON.stringify(e) + "\n", (err) => {
    /* istanbul ignore next */
    if (err) console.error("[traceprompt] WAL write failed", err);
  });
}

/* ---------- 3. Flush scheduler (runs in main thread) -------------- */

export function startFlusher() {
  setInterval(drainAndPost, settings.flushIntervalMs);
}

async function drainAndPost() {
  if (tail === head) return; // nothing to flush

  const batch: BatchPayload = [];
  while (tail !== head && batch.length < batchSize) {
    batch.push(buf[tail]!);
    buf[tail] = undefined; // free for GC
    tail = (tail + 1) % batchSize;
  }
  parentPort?.postMessage({ type: "batch", payload: batch });
}

/* ---------- 4. WAL replay on startup ------------------------------ */

export function replayWal() {
  if (!settings.walPath || !fs.existsSync(settings.walPath)) return;

  const lines = fs.readFileSync(settings.walPath, "utf8").trim().split("\n");
  lines.forEach((l) => {
    try {
      enqueue(JSON.parse(l) as LogEntry);
    } catch {
      /* malformed line, skip */
    }
  });
  fs.truncateSync(settings.walPath, 0); // reset WAL
}
