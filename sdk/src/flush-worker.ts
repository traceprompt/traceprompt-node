/* ------------------------------------------------------------------
 * flusherWorker.ts  •  Runs in a Worker Thread
 * ------------------------------------------------------------------
 *  ▸ Receives { type:'batch', payload: LogEntry[] } via parentPort
 *  ▸ Pushes batch to the ingest API with TLS / optional mTLS
 *  ▸ Retries with exponential back-off (max 5 attempts)
 * ------------------------------------------------------------------ */

import { parentPort, workerData } from "node:worker_threads";
import https from "node:https";
import axios, { AxiosInstance } from "axios";
import type { BatchPayload } from "./types";

/* ---------- 1. Config from the main thread ------------------------ *
 *  index.ts passes these via workerData or environment variables.
 * ------------------------------------------------------------------ */
const {
  API_URL = process.env.TP_API_URL ?? "https://collector.traceprompt.ai/logs",
  API_KEY = process.env.TP_API_KEY, // mandatory
  TLS_CA = process.env.TP_TLS_CA, // optional
  TLS_CERT = process.env.TP_TLS_CERT,
  TLS_KEY = process.env.TP_TLS_KEY,
  MTLS = process.env.TP_MTLS === "true",
} = workerData || {};

/* ---------- 2. HTTPS agent (supports mTLS) ------------------------ */
const httpsAgent = new https.Agent({
  keepAlive: true,
  ca: TLS_CA,
  cert: MTLS ? TLS_CERT : undefined,
  key: MTLS ? TLS_KEY : undefined,
});

/* ---------- 3. Axios client -------------------------------------- */
const client: AxiosInstance = axios.create({
  httpsAgent,
  headers: { "x-api-key": API_KEY },
  timeout: 5_000,
});

/* ---------- 4. In-memory retry queue ----------------------------- */
interface QueueItem {
  batch: BatchPayload;
  attempt: number;
}
const queue: QueueItem[] = [];

/* ---------- 5. parentPort listener -------------------------------- */
parentPort!.on("message", (msg: any) => {
  if (msg?.type === "batch") queue.push({ batch: msg.payload, attempt: 0 });
});

/* ---------- 6. Worker loop --------------------------------------- */
(async function loop() {
  while (true) {
    const item = queue.shift();
    if (!item) {
      await sleep(20);
      continue;
    }

    try {
      await client.post(API_URL, item.batch, {
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      // Handle unknown error type safely
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[traceprompt] ingest error", errorMessage);

      if (item.attempt < 5) {
        const backoff = 2 ** item.attempt * 100; // 100, 200, 400, 800, 1600 ms
        setTimeout(
          () => queue.push({ ...item, attempt: item.attempt + 1 }),
          backoff
        );
      } else {
        console.error("[traceprompt] drop batch after 5 failed attempts");
      }
    }
  }
})();

/* ---------- 7. Utils --------------------------------------------- */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
