import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { LogEntry } from "../../src/types";

describe("buffer.ts", () => {
  let tempWalPath = path.join(process.cwd(), "temp-test-wal.json");
  const batchSize = 5;
  const flushIntervalMs = 50;

  let buffer: LogEntry[] = new Array(batchSize);
  let head = 0;
  let tail = 0;

  const mockPostMessage = vi.fn();

  function enqueue(entry: LogEntry): boolean {
    buffer[head] = entry;
    head = (head + 1) % batchSize;

    if (head === tail) {
      spillToWal(buffer[tail]!);
      tail = (tail + 1) % batchSize;
      return false;
    }
    return true;
  }

  function spillToWal(entry: LogEntry) {
    if (!tempWalPath) return;
    fs.appendFile(tempWalPath, JSON.stringify(entry) + "\n", (err) => {
      if (err) console.error("[test] WAL write failed", err);
    });
  }

  function startFlusher() {
    return setInterval(drainAndPost, flushIntervalMs);
  }

  function drainAndPost() {
    if (tail === head) return;

    const batch: LogEntry[] = [];
    while (tail !== head && batch.length < batchSize) {
      batch.push(buffer[tail]!);
      buffer[tail] = undefined as any;
      tail = (tail + 1) % batchSize;
    }

    mockPostMessage({ type: "batch", payload: batch });
  }

  function replayWal() {
    if (!tempWalPath || !fs.existsSync(tempWalPath)) return;

    const lines = fs.readFileSync(tempWalPath, "utf8").trim().split("\n");
    lines.forEach((line) => {
      try {
        enqueue(JSON.parse(line) as LogEntry);
      } catch {}
    });
    fs.truncateSync(tempWalPath, 0);
  }

  function createLogEntry(id: number): LogEntry {
    return {
      ts: Date.now() + id,
      prompt: `Test prompt ${id}`,
      response: `Test response ${id}`,
      meta: { latency_ms: 100 + id, model: "gpt-4" },
      prevHash: id === 0 ? null : `hash-${id - 1}`,
      hash: `hash-${id}`,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockPostMessage.mockClear();
    buffer = new Array(batchSize);
    head = 0;
    tail = 0;

    tempWalPath = path.join(process.cwd(), "temp-test-wal.json");

    if (fs.existsSync(tempWalPath)) {
      fs.unlinkSync(tempWalPath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempWalPath)) {
      fs.unlinkSync(tempWalPath);
    }

    vi.useRealTimers();
  });

  describe("enqueue", () => {
    it("should add an entry to the buffer", () => {
      const entry = createLogEntry(1);
      const result = enqueue(entry);

      expect(result).toBe(true);
      expect(head).toBe(1);
      expect(tail).toBe(0);
      expect(buffer[0]).toEqual(entry);
    });

    it("should handle multiple entries within buffer capacity", () => {
      for (let i = 0; i < 3; i++) {
        const entry = createLogEntry(i);
        enqueue(entry);
        expect(buffer[i]).toEqual(entry);
      }

      expect(head).toBe(3);
      expect(tail).toBe(0);
    });

    it("should spill to WAL when buffer is full", () => {
      const appendFileSpy = vi.spyOn(fs, "appendFile");

      for (let i = 0; i < batchSize; i++) {
        enqueue(createLogEntry(i));
      }

      const overflow = createLogEntry(batchSize);
      const result = enqueue(overflow);

      expect(result).toBe(false);
      expect(appendFileSpy).toHaveBeenCalled();

      expect(head).toBe(1);
      expect(tail).toBe(2);
    });

    it("should not spill to WAL if walPath is disabled", () => {
      const originalWalPath = tempWalPath;
      const appendFileSpy = vi.spyOn(fs, "appendFile");

      try {
        tempWalPath = "";

        for (let i = 0; i <= batchSize; i++) {
          enqueue(createLogEntry(i));
        }

        expect(appendFileSpy).not.toHaveBeenCalled();
      } finally {
        tempWalPath = originalWalPath;
      }
    });
  });

  describe("startFlusher", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("should schedule flushes at the configured interval", () => {
      const intervalId = startFlusher();

      expect(mockPostMessage).not.toHaveBeenCalled();

      for (let i = 0; i < 3; i++) {
        enqueue(createLogEntry(i));
      }

      vi.advanceTimersByTime(flushIntervalMs + 10);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const payload = mockPostMessage.mock.calls[0][0].payload;
      expect(payload.length).toBe(3);

      expect(head).toBe(3);
      expect(tail).toBe(3);

      for (let i = 3; i < 5; i++) {
        enqueue(createLogEntry(i));
      }

      vi.advanceTimersByTime(flushIntervalMs + 10);
      expect(mockPostMessage).toHaveBeenCalledTimes(2);

      clearInterval(intervalId);
    });

    it("should not flush if buffer is empty", () => {
      const intervalId = startFlusher();

      vi.advanceTimersByTime(flushIntervalMs * 2);
      expect(mockPostMessage).not.toHaveBeenCalled();

      clearInterval(intervalId);
    });

    it("should respect batch size limit when flushing", () => {
      for (let i = 0; i < batchSize + 2; i++) {
        enqueue(createLogEntry(i));
      }

      const intervalId = startFlusher();
      vi.advanceTimersByTime(flushIntervalMs + 10);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const firstBatch = mockPostMessage.mock.calls[0][0].payload;
      expect(firstBatch.length).toBe(4);

      for (let i = batchSize + 2; i < batchSize + 4; i++) {
        enqueue(createLogEntry(i));
      }

      vi.advanceTimersByTime(flushIntervalMs + 10);
      expect(mockPostMessage).toHaveBeenCalledTimes(2);

      clearInterval(intervalId);
    });
  });

  describe("replayWal", () => {
    it("should not attempt replay if WAL file doesn't exist", () => {
      const readSpy = vi.spyOn(fs, "readFileSync");
      replayWal();
      expect(readSpy).not.toHaveBeenCalled();
    });

    it("should replay entries from WAL into buffer", () => {
      const entries = [createLogEntry(1), createLogEntry(2), createLogEntry(3)];

      fs.writeFileSync(
        tempWalPath,
        entries.map((e) => JSON.stringify(e)).join("\n")
      );

      const truncateSpy = vi.spyOn(fs, "truncateSync");

      replayWal();

      expect(head).toBe(3);
      expect(buffer[0]).toEqual(entries[0]);
      expect(buffer[1]).toEqual(entries[1]);
      expect(buffer[2]).toEqual(entries[2]);

      expect(truncateSpy).toHaveBeenCalledWith(tempWalPath, 0);
    });

    it("should skip malformed JSON in WAL", () => {
      fs.writeFileSync(
        tempWalPath,
        [
          JSON.stringify(createLogEntry(1)),
          "invalid json",
          JSON.stringify(createLogEntry(2)),
        ].join("\n")
      );

      replayWal();

      expect(head).toBe(2);
      expect(buffer[0]).toHaveProperty("hash", "hash-1");
      expect(buffer[1]).toHaveProperty("hash", "hash-2");
    });

    it("should not replay if WAL is disabled", () => {
      fs.writeFileSync(tempWalPath, JSON.stringify(createLogEntry(1)));

      const originalWalPath = tempWalPath;

      try {
        tempWalPath = "";

        const readSpy = vi.spyOn(fs, "readFileSync");

        replayWal();
        expect(readSpy).not.toHaveBeenCalled();
      } finally {
        tempWalPath = originalWalPath;
      }
    });
  });
});
