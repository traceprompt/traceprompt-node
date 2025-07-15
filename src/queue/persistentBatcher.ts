import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { ConfigManager } from "../config";
import type { QueueItem } from "../types";
import { Transport } from "../network/transport";
import { log } from "../utils/logger";
import { queueGauge, flushFailures } from "../metrics";

function getConfig() {
  return ConfigManager.cfg;
}

function getDir() {
  const cfg = getConfig();
  return path.resolve(cfg.dataDir ?? ".traceprompt", "queue");
}

function getLogPath() {
  return path.join(getDir(), "outbox.log");
}

function getMaxRamRecords() {
  const cfg = getConfig();
  return (cfg.batchSize || 10) * 2;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

let bootstrapDone = false;
let pLimitPromise: Promise<any> | null = null;
let closing = false;

async function getPLimit() {
  if (!pLimitPromise) {
    pLimitPromise = import("p-limit").then((module) => module.default);
  }
  return pLimitPromise;
}

async function bootstrap() {
  if (bootstrapDone) return;
  await fs.mkdir(getDir(), { recursive: true });
  bootstrapDone = true;
}

let ring: QueueItem[] = [];
let head = 0;
let len = 0;
let ringInitialized = false;

function initializeRing() {
  if (ringInitialized) return;
  const maxRecords = getMaxRamRecords();
  ring = new Array(maxRecords);
  ringInitialized = true;
}

function ringPush(item: QueueItem) {
  initializeRing();
  const maxRecords = getMaxRamRecords();

  ring[(head + len) % maxRecords] = item;
  if (len < maxRecords) {
    len++;
    return;
  }
  head = (head + 1) % maxRecords;
}

function ringDrip(n: number): QueueItem[] {
  initializeRing();
  const maxRecords = getMaxRamRecords();
  const out: QueueItem[] = [];

  while (out.length < n && len > 0) {
    out.push(ring[head]);
    head = (head + 1) % maxRecords;
    len--;
  }
  return out;
}

async function append(item: QueueItem) {
  if (closing) {
    throw new Error("Traceprompt SDK is shutting down, rejecting new events");
  }

  await bootstrap();
  initializeTimer();

  const rec = JSON.stringify({ id: randomUUID(), ...item }) + "\n";

  try {
    await fs.appendFile(getLogPath(), rec, "utf8");
    log.debug("Record appended to outbox", {
      outboxPath: getLogPath(),
      recordSize: rec.length,
    });
  } catch (error) {
    log.error("Failed to append record to outbox", {
      error: error instanceof Error ? error.message : String(error),
      outboxPath: getLogPath(),
    });
    throw error;
  }

  ringPush(item);
  queueGauge.set(len);
  log.verbose("Record added to ring buffer", {
    ringSize: len,
    maxRingSize: getMaxRamRecords(),
  });

  try {
    const { size } = await fs.stat(getLogPath());
    if (size > MAX_FILE_BYTES) {
      log.error("Outbox file size exceeded limit - applying backpressure", {
        currentSize: size,
        maxSize: MAX_FILE_BYTES,
        outboxPath: getLogPath(),
      });
      throw new Error(
        "Traceprompt SDK backpressure: local outbox full, ingest unreachable."
      );
    }

    if (size > MAX_FILE_BYTES * 0.8) {
      log.warn("Outbox file size approaching limit", {
        currentSize: size,
        maxSize: MAX_FILE_BYTES,
        percentFull: Math.round((size / MAX_FILE_BYTES) * 100),
        outboxPath: getLogPath(),
      });
    }
  } catch (e) {
    if ((e as any).code !== "ENOENT") {
      log.warn("Failed to check outbox file size", {
        error: e instanceof Error ? e.message : String(e),
        outboxPath: getLogPath(),
      });
      throw e;
    }
  }
}

let limit: any = null;

async function flushOnce() {
  await bootstrap();
  initializeTimer();

  if (!limit) {
    const pLimit = await getPLimit();
    limit = pLimit(1);
  }

  return limit(async () => {
    const cfg = getConfig();
    const batchSize = cfg.batchSize || 10;

    let batch: (QueueItem & { id: string })[] = [];
    const ringRecords = ringDrip(batchSize);

    if (ringRecords.length > 0) {
      log.verbose("Using ring buffer records for flush", {
        ringRecords: ringRecords.length,
        batchSize: batchSize,
      });

      batch = ringRecords.map((record) => ({
        id: randomUUID(),
        ...record,
      }));
    }

    let diskLines: string[] = [];
    let totalDiskRecords = 0;

    if (batch.length < batchSize) {
      const needed = batchSize - batch.length;

      try {
        const rl = createInterface({ input: createReadStream(getLogPath()) });
        const diskBatch: (QueueItem & { id: string })[] = [];

        for await (const line of rl) {
          if (!line.trim()) continue;

          if (diskBatch.length < needed) {
            diskBatch.push(JSON.parse(line));
          }

          diskLines.push(line);
          totalDiskRecords++;

          if (diskBatch.length >= needed && totalDiskRecords >= needed * 2) {
            break;
          }
        }

        rl.close();

        if (diskBatch.length > 0) {
          log.verbose("Supplementing with disk records", {
            ringRecords: batch.length,
            diskRecords: diskBatch.length,
            totalDiskRecordsRead: totalDiskRecords,
          });

          batch.push(...diskBatch);
        }
      } catch (error: any) {
        if (error.code === "ENOENT") {
          if (batch.length === 0) {
            log.debug("No records in ring buffer or disk, nothing to flush");
            return;
          }
        } else {
          log.warn("Error reading outbox file", {
            error: error.message,
            outboxPath: getLogPath(),
          });
        }
      }
    } else {
      try {
        const rl = createInterface({ input: createReadStream(getLogPath()) });

        for await (const line of rl) {
          if (line.trim()) {
            diskLines.push(line);
            totalDiskRecords++;
          }
        }

        rl.close();
      } catch (error: any) {
        if (error.code !== "ENOENT") {
          log.warn("Error counting disk records", {
            error: error.message,
            outboxPath: getLogPath(),
          });
        }
      }
    }

    if (batch.length === 0) {
      log.debug("No records available for flush");
      return;
    }

    const totalPending =
      totalDiskRecords + (ringRecords.length > batch.length ? 0 : len);

    queueGauge.set(totalPending);

    log.info("Starting batch flush", {
      batchSize: batch.length,
      fromRingBuffer: Math.min(ringRecords.length, batch.length),
      fromDisk: Math.max(0, batch.length - ringRecords.length),
      totalPendingAfterFlush: totalPending - batch.length,
      outboxPath: getLogPath(),
    });

    const body = {
      orgId: cfg.orgId,
      records: batch.map(({ payload, leafHash }) => ({ payload, leafHash })),
    };

    try {
      // @ts-expect-error - TODO: fix this
      await Transport.post("/v1/ingest", body, {
        "Idempotency-Key": batch[0].leafHash,
      });

      if (totalDiskRecords > 0) {
        const diskRecordsUsed = Math.max(0, batch.length - ringRecords.length);
        if (diskRecordsUsed > 0) {
          let allDiskLines: string[];

          if (diskLines.length === totalDiskRecords) {
            allDiskLines = diskLines;
          } else {
            try {
              const text = await fs.readFile(getLogPath(), "utf8");
              allDiskLines = text.trim().split("\n").filter(Boolean);
            } catch (error) {
              log.error("Failed to read outbox file for cleanup", {
                error: error instanceof Error ? error.message : String(error),
                outboxPath: getLogPath(),
              });
              return;
            }
          }

          const remaining = allDiskLines.slice(diskRecordsUsed);
          if (remaining.length > 0) {
            await fs.writeFile(getLogPath(), remaining.join("\n") + "\n");
            log.info("Batch flush successful, updated outbox", {
              flushedRecords: batch.length,
              fromRingBuffer: ringRecords.length,
              fromDisk: diskRecordsUsed,
              remainingOnDisk: remaining.length,
            });
            queueGauge.set(totalPending - batch.length);
          } else {
            await fs.writeFile(getLogPath(), "");
            log.info("Batch flush successful, outbox cleared", {
              flushedRecords: batch.length,
              fromRingBuffer: ringRecords.length,
              fromDisk: diskRecordsUsed,
            });
            queueGauge.set(totalPending - batch.length);
          }
        } else {
          log.info("Batch flush successful, used only ring buffer", {
            flushedRecords: batch.length,
            diskRecordsRemaining: totalDiskRecords,
          });
          queueGauge.set(totalPending - batch.length);
        }
      } else {
        log.info("Batch flush successful, used only ring buffer", {
          flushedRecords: batch.length,
        });
        queueGauge.set(totalPending - batch.length);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      if (ringRecords.length > 0) {
        log.warn("Flush failed, restoring ring buffer records to disk", {
          ringRecordsToRestore: ringRecords.length,
        });

        const ringRecordsAsLines = ringRecords.map((record) =>
          JSON.stringify({ id: randomUUID(), ...record })
        );

        try {
          let existingContent = "";
          try {
            existingContent = await fs.readFile(getLogPath(), "utf8");
          } catch {}

          const allLines = [...ringRecordsAsLines];
          if (existingContent.trim()) {
            allLines.push(
              ...existingContent.trim().split("\n").filter(Boolean)
            );
          }

          await fs.writeFile(getLogPath(), allLines.join("\n") + "\n");
        } catch (restoreError) {
          log.error("Failed to restore ring buffer records to disk", {
            error:
              restoreError instanceof Error
                ? restoreError.message
                : String(restoreError),
            lostRecords: ringRecords.length,
          });
        }
      }

      if (errorMessage.includes("HTTP 5")) {
        log.warn("Server error during batch flush, will retry", {
          error: errorMessage,
          batchSize: batch.length,
          totalPending: totalPending,
        });
      } else if (errorMessage.includes("HTTP 429")) {
        log.warn("Rate limited during batch flush, will retry", {
          error: errorMessage,
          batchSize: batch.length,
          totalPending: totalPending,
        });
      } else if (errorMessage.includes("HTTP 4")) {
        log.error("Client error during batch flush", {
          error: errorMessage,
          batchSize: batch.length,
          totalPending: totalPending,
          hint: "Check API configuration and request format",
        });
      } else {
        log.error("Network error during batch flush", {
          error: errorMessage,
          batchSize: batch.length,
          totalPending: totalPending,
        });
      }

      flushFailures.inc();

      throw e;
    }
  });
}

let timerInitialized = false;
let flushTimer: NodeJS.Timeout | null = null;

function initializeTimer() {
  if (timerInitialized) return;
  timerInitialized = true;

  const cfg = getConfig();
  log.info("Initializing periodic flush timer", {
    flushIntervalMs: cfg.flushIntervalMs,
  });

  flushTimer = setInterval(
    () =>
      flushOnce().catch((error) => {
        log.verbose("Periodic flush failed, will retry on next interval", {
          error: error instanceof Error ? error.message : String(error),
          nextRetryIn: cfg.flushIntervalMs,
        });
      }),
    cfg.flushIntervalMs
  );
  flushTimer.unref();
}

async function flushWithRetry(opts: { maxRetries: number }): Promise<void> {
  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      await flushOnce();
      return; // Success
    } catch (error) {
      if (attempt === opts.maxRetries) throw error;

      const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 4000);
      log.debug("Flush attempt failed, retrying", {
        attempt,
        maxRetries: opts.maxRetries,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function drainOutboxWithRetry(opts: {
  maxRetries: number;
  maxTimeoutMs: number;
}): Promise<void> {
  const startTime = Date.now();
  let attempt = 0;

  while (Date.now() - startTime < opts.maxTimeoutMs) {
    attempt++;

    try {
      // Check if outbox is empty
      const outboxContent = await fs
        .readFile(getLogPath(), "utf8")
        .catch(() => "");
      if (!outboxContent.trim()) {
        log.info("Outbox is empty, drain complete");
        return;
      }

      // Flush with retry
      await flushWithRetry({ maxRetries: opts.maxRetries });
    } catch (error) {
      log.warn("Outbox drain attempt failed", {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });

      const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 4000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Outbox drain timed out after ${opts.maxTimeoutMs}ms`);
}

async function gracefulShutdown(): Promise<void> {
  log.info("Starting graceful shutdown");
  closing = true; // Stop accepting new events

  if (flushTimer) {
    clearInterval(flushTimer);
    log.debug("Cleared periodic flush timer");
  }

  // 1. Flush in-memory ring buffer first
  log.info("Flushing in-memory ring buffer");
  await flushWithRetry({ maxRetries: 3 });

  // 2. Drain entire outbox.log file
  log.info("Draining persistent outbox");
  await drainOutboxWithRetry({ maxRetries: 5, maxTimeoutMs: 30_000 });

  log.info("Graceful shutdown completed successfully");
}

process.on("SIGTERM", async () => {
  try {
    await gracefulShutdown();
    process.exit(0);
  } catch (error) {
    log.error("Graceful shutdown failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    flushFailures.inc();
    process.exit(1); // Non-zero exit for K8s to detect failure
  }
});

process.on("SIGINT", async () => {
  try {
    await gracefulShutdown();
    process.exit(0);
  } catch (error) {
    log.error("Graceful shutdown failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    flushFailures.inc();
    process.exit(1); // Non-zero exit for K8s to detect failure
  }
});

export const PersistentBatcher = {
  enqueue: append,
  flush: flushOnce,
  gracefulShutdown,
};
