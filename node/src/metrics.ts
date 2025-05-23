/**
 * metrics.ts
 * ------------------------------------------------------
 * Optional Prometheus metrics.  If an application does not
 * import this file, all metric references in other modules
 * fall back to safe no-ops to avoid hard dependency.
 *
 * Exposes:
 *   • registry         – main Prometheus Registry
 *   • encryptHist      – Histogram tracking encryption latency
 *   • flushFailures    – Counter for failed batch flushes
 *   • queueGauge       – Gauge for current in-memory queue size
 * ------------------------------------------------------
 */

import { Registry, Histogram, Counter, Gauge } from "prom-client";

export const registry = new Registry();

/* ---------- Histogram: encryption latency ------------------------ */
export const encryptHist = new Histogram({
  name: "traceprompt_encrypt_ms",
  help: "Latency of client-side AES-GCM envelope encryption (ms)",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

/* ---------- Counter: batch flush failures ------------------------ */
export const flushFailures = new Counter({
  name: "traceprompt_flush_failures_total",
  help: "Number of failed POSTs to the TracePrompt ingest API",
  registers: [registry],
});

/* ---------- Gauge: current queue depth --------------------------- */
export const queueGauge = new Gauge({
  name: "traceprompt_queue_depth",
  help: "Number of events currently buffered in memory",
  registers: [registry],
});
