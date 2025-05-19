/* ------------------------------------------------------------------
 * index.ts  •  Public API surface for @traceprompt/sdk
 * ------------------------------------------------------------------ */

import { Worker } from "node:worker_threads";
import path from "node:path";

import { initSettings, settings, state } from "./utils/state";
import { enqueue, startFlusher, replayWal } from "./utils/buffer";
import { redact } from "./utils/redactor";
import { link } from "./utils/hash";
import type { InitOptions, JSONValue } from "./utils/types";

/* ---------- 1. Initialise SDK ------------------------------------ */

export function init(opts: InitOptions) {
  initSettings(opts);
  replayWal(); // read un-flushed records from previous crash
  startNetworkWorker(); // spins flusher worker thread
  startFlusher(); // schedule drain in main thread
  console.info("[traceprompt] SDK ready");
}

/* ---------- 2. Wrap helper --------------------------------------- */

export function wrap<T extends new (...args: any[]) => any>(LLMCls: T): T {
  return class Wrapped extends LLMCls {
    /** override chat.completions.create / similar */
    async chat(...args: any[]) {
      const [params] = args;
      const t0 = performance.now();

      // call original method
      const res = await super.chat(...args);
      const latency = performance.now() - t0;

      /* ---------- create log entry ------------------------------ */
      const entryCore = {
        ts: Date.now(),
        prompt: redact(params, settings.piiRedact),
        response: redact(res, settings.piiRedact),
        meta: {
          latency_ms: latency,
          model: params.model,
          ...pendingMeta, // see enrich()
        },
      };

      // clear meta bag
      pendingMeta = {};

      const entry = link(state.chainHead, entryCore);
      state.chainHead = entry.hash;

      enqueue(entry); // non-blocking push

      return res;
    }
  } as any as T;
}

/* ---------- 3. Metadata enrichment helper ----------------------- */
let pendingMeta: Record<string, JSONValue> = {};

/** Call just before your LLM call to attach user IDs, etc. */
export function enrich(meta: Record<string, JSONValue>) {
  Object.assign(pendingMeta, meta);
}

/* ---------- 4. Worker thread for network I/O -------------------- */

function startNetworkWorker() {
  const workerPath = path.join(__dirname, "flush-worker.js");
  const worker = new Worker(workerPath, {
    env: { TP_API_KEY: settings.apiKey },
  });

  worker.on("error", (err) =>
    console.error("[traceprompt] flusher worker error", err)
  );

  worker.on("exit", (code) => {
    if (code !== 0) {
      console.error(
        `[traceprompt] flusher worker exited with ${code}; respawning…`
      );
      startNetworkWorker();
    }
  });
}
