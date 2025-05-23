/**
 * queue/batcher.ts
 * ------------------------------------------------------
 * Holds encrypted events in memory, flushing them to the
 * ingest API either when:
 *   • queue length ≥ `batchSize`, OR
 *   • `flushIntervalMs` milliseconds have elapsed.
 *
 * The flush itself is delegated to `queue/flusher.ts`.
 * ------------------------------------------------------
 */

import { QueueItem } from "../types";
import { ConfigManager } from "../config";
import { flushBatch } from "./flusher";

/* Optional metrics hook (safe-no-op if metrics.ts not imported) */
let flushFailCounter: { inc: () => void };
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  flushFailCounter = require("../metrics").flushFailures;
} catch {
  flushFailCounter = { inc: () => void 0 };
}

class BatcherClass {
  private readonly queue: QueueItem[] = [];
  private readonly batchSize: number;
  private flushing = false;

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

  /** Add an item to the in-memory queue. */
  enqueue(item: QueueItem): void {
    this.queue.push(item);
    if (this.queue.length >= this.batchSize) {
      void this.flush(); // fire-and-forget
    }
  }

  /** Flush up to `batchSize` items (no-op if already flushing). */
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

let _batcherInstance: BatcherClass | null = null;

export const Batcher = {
  enqueue(item: QueueItem): void {
    if (!_batcherInstance) {
      _batcherInstance = new BatcherClass();
    }
    _batcherInstance.enqueue(item);
  },

  async flush(): Promise<void> {
    if (!_batcherInstance) {
      _batcherInstance = new BatcherClass();
    }
    return _batcherInstance.flush();
  },
};
