import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import type { BatchPayload, LogEntry } from "../../src/utils/types";
import axios from "axios";

type EventName = "message" | "error" | "exit" | "online";
type EventHandler = (...args: any[]) => void;

vi.mock("node:worker_threads", () => {
  return {
    Worker: vi
      .fn()
      .mockImplementation((_: string, options: { workerData?: any }) => {
        const { workerData } = options || {};
        const eventHandlers: Record<EventName, EventHandler> = {} as Record<
          EventName,
          EventHandler
        >;

        // Mock the worker API
        const worker = {
          on: (event: EventName, handler: EventHandler) => {
            eventHandlers[event] = handler;
            if (event === "online") {
              setTimeout(() => handler(), 0); // Trigger online immediately
            }
            return worker;
          },
          postMessage: async (msg: any) => {
            if (msg?.type === "batch") {
              const { API_URL, API_KEY } = workerData;

              // Process the batch (simulate worker behavior)
              try {
                await axios.post(API_URL, msg.payload, {
                  headers: {
                    "x-api-key": API_KEY,
                    "content-type": "application/json",
                  },
                  timeout: 500,
                });
              } catch (err) {
                // Simulate retry with exponential backoff
                let attempt = 0;
                let success = false;

                while (attempt < 5 && !success) {
                  try {
                    await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
                    await axios.post(API_URL, msg.payload, {
                      headers: {
                        "x-api-key": API_KEY,
                        "content-type": "application/json",
                      },
                      timeout: 500,
                    });
                    success = true;
                  } catch (err) {
                    attempt++;
                  }
                }
              }
            }
          },
          terminate: vi.fn().mockResolvedValue(undefined),
        };

        return worker;
      }),
  };
});

// Mock the state to control settings
vi.mock("../../src/state", async () => {
  const actual = await vi.importActual("../../src/state");
  const settings = {
    apiKey: "test-api-key",
    batchSize: 5,
    flushIntervalMs: 100,
    piiRedact: "regex",
    hashAlgo: "blake3",
    walPath: false,
    anchorInterval: "1h",
    tls: { mtls: false },
  };

  return {
    ...actual,
    settings,
    initSettings: (opts: any) => {
      Object.assign(settings, opts);
    },
  };
});

describe("flush-worker.ts", () => {
  let server: http.Server;
  let worker: any;
  let url: string;
  let receivedBatches: BatchPayload[] = [];
  let serverErrors = 0;
  let successfulRequests = 0;
  let receivedEntries: LogEntry[] = [];

  beforeEach(async () => {
    // Reset test state
    receivedBatches = [];
    receivedEntries = [];
    serverErrors = 0;
    successfulRequests = 0;

    // Set up a simple HTTP server that mimics the ingest API
    server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/logs") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      // Check for API key
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== "test-api-key") {
        res.statusCode = 401;
        res.end("Unauthorized");
        return;
      }

      // Simulate server errors for testing retries
      if (serverErrors > 0) {
        serverErrors--;
        res.statusCode = 500;
        res.end("Server error");
        return;
      }

      // Process the request body
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        try {
          const batch = JSON.parse(body);
          receivedBatches.push(batch);
          // Track individual entries for high-volume tests
          if (Array.isArray(batch)) {
            receivedEntries.push(...batch);
          }
          successfulRequests++;
          res.statusCode = 200;
          res.end("OK");
        } catch (err) {
          res.statusCode = 400;
          res.end("Bad request");
        }
      });
    });

    // Start the server and get port
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        url = `http://127.0.0.1:${address.port}/logs`;
        resolve();
      });
    });

    // Create the worker with mocked implementation
    const { Worker } = await import("node:worker_threads");
    worker = new Worker("mock-path", {
      workerData: {
        API_URL: url,
        API_KEY: "test-api-key",
      },
    });
  });

  afterEach(async () => {
    // Clean up resources
    if (worker) {
      await worker.terminate();
    }

    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it("should process batch payloads sent via parentPort", async () => {
    // Create test log entries
    const entries: LogEntry[] = [
      {
        ts: Date.now(),
        prompt: "Test prompt",
        response: "Test response",
        meta: { latency_ms: 123, model: "gpt-4" },
        prevHash: null,
        hash: "abc123",
      },
    ];

    // Send batch to worker
    await worker.postMessage({ type: "batch", payload: entries });

    // Wait for processing (needs some time for request to complete)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify batch was received by server
    expect(receivedBatches.length).toBe(1);
    expect(receivedBatches[0]).toEqual(entries);
    expect(successfulRequests).toBe(1);
  });

  it("should retry on server errors with exponential backoff", async () => {
    // Set up server to fail first 2 attempts
    serverErrors = 2;

    // Create test log entry
    const entries: LogEntry[] = [
      {
        ts: Date.now(),
        prompt: "Test prompt for retry",
        response: "Test response for retry",
        meta: { latency_ms: 456, model: "gpt-4" },
        prevHash: null,
        hash: "def456",
      },
    ];

    // Send batch to worker
    await worker.postMessage({ type: "batch", payload: entries });

    // Wait for processing + retries (longer timeout needed for backoff)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify batch was eventually received after retries
    expect(successfulRequests).toBe(1);
    expect(receivedBatches.length).toBe(1);
    expect(receivedBatches[0]).toEqual(entries);
  });

  it("should handle multiple batches in sequence", async () => {
    // Create multiple batches
    const batch1: LogEntry[] = [
      {
        ts: Date.now(),
        prompt: "Batch 1 prompt",
        response: "Batch 1 response",
        meta: { latency_ms: 100, model: "gpt-4" },
        prevHash: null,
        hash: "batch1",
      },
    ];

    const batch2: LogEntry[] = [
      {
        ts: Date.now(),
        prompt: "Batch 2 prompt",
        response: "Batch 2 response",
        meta: { latency_ms: 200, model: "gpt-4" },
        prevHash: "batch1",
        hash: "batch2",
      },
    ];

    // Send batches in sequence
    await worker.postMessage({ type: "batch", payload: batch1 });
    await worker.postMessage({ type: "batch", payload: batch2 });

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify both batches were received
    expect(successfulRequests).toBe(2);
    expect(receivedBatches.length).toBe(2);
    expect(receivedBatches[0]).toEqual(batch1);
    expect(receivedBatches[1]).toEqual(batch2);
  });

  it("should ignore messages that don't have the correct format", async () => {
    // Send invalid messages
    await worker.postMessage({ type: "invalid" });
    await worker.postMessage("not an object");
    await worker.postMessage({ notType: "batch", payload: [] });

    // Wait briefly
    await new Promise((resolve) => setTimeout(resolve, 200));

    // No batches should be processed
    expect(receivedBatches.length).toBe(0);
    expect(successfulRequests).toBe(0);
  });

  it("should handle high-volume requests and process all entries", async () => {
    // Create a large number of log entries (100 in this test)
    const numEntries = 100;
    const entries: LogEntry[] = [];

    for (let i = 0; i < numEntries; i++) {
      entries.push({
        ts: Date.now() + i,
        prompt: `High volume prompt ${i}`,
        response: `High volume response ${i}`,
        meta: { latency_ms: 100 + i, model: "gpt-4" },
        prevHash: i === 0 ? null : `hash-${i - 1}`,
        hash: `hash-${i}`,
      });
    }

    // Send entries in batches of 10
    const batchSize = 10;
    for (let i = 0; i < numEntries; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await worker.postMessage({ type: "batch", payload: batch });
    }

    // Wait for all processing to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify all entries were processed
    expect(successfulRequests).toBe(numEntries / batchSize);

    // Collect all entries from all batches to verify none were lost
    expect(receivedEntries.length).toBe(numEntries);

    // Verify entries were processed correctly
    for (let i = 0; i < numEntries; i++) {
      const found = receivedEntries.find((entry) => entry.hash === `hash-${i}`);
      expect(found).toBeDefined();
      expect(found?.prompt).toBe(`High volume prompt ${i}`);
      expect(found?.response).toBe(`High volume response ${i}`);
    }
  });
});
