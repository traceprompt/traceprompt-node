import { QueueItem } from "../types";
import { ConfigManager } from "../config";
import { flushBatch } from "./flusher";

class BatcherClass {
  private q: QueueItem[] = [];
  private timer: NodeJS.Timeout;

  constructor() {
    const { flushIntervalMs } = ConfigManager.cfg;
    this.timer = setInterval(() => this.flush(), flushIntervalMs).unref();
  }

  enqueue(item: QueueItem) {
    this.q.push(item);
    if (this.q.length >= ConfigManager.cfg.batchSize) this.flush();
  }

  async flush() {
    if (!this.q.length) return;
    const batch = this.q.splice(0, ConfigManager.cfg.batchSize);
    await flushBatch(batch); // network layer handles retry
  }
}

export const Batcher = new BatcherClass();
