import { Registry, Histogram, Counter, Gauge } from "prom-client";

export const registry = new Registry();

export const encryptHist = new Histogram({
  name: "traceprompt_encrypt_ms",
  help: "Latency of client-side AES-GCM envelope encryption (ms)",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const flushFailures = new Counter({
  name: "traceprompt_flush_failures_total",
  help: "Number of failed POSTs to the Traceprompt ingest API",
  registers: [registry],
});

export const queueGauge = new Gauge({
  name: "traceprompt_queue_depth",
  help: "Number of events currently buffered in memory",
  registers: [registry],
});
