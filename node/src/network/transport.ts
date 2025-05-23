/**
 * network/transport.ts
 * ------------------------------------------------------
 * Minimal HTTP client wrapper using the Undici fetch
 * implementation (Node ≥18).  Handles JSON encoding,
 * adds basic headers, and applies exponential-back-off
 * retry logic via utils/retry.ts.
 * ------------------------------------------------------
 */

import { fetch } from "undici";
import { ConfigManager } from "../config";
import { retry } from "../utils/retry";

type HttpMethod = "POST" | "PUT" | "PATCH";

interface PostOptions {
  /** Path that will be appended to ingestUrl (e.g., "/v1/ingest"). */
  path: string;
  /** JavaScript object that will be JSON-serialised. */
  body: unknown;
  /** HTTP method (default "POST"). */
  method?: HttpMethod;
  /** How many retries before surfacing error (default 5). */
  retries?: number;
}

/* ---------- Public API ------------------------------------------- */
export const Transport = {
  /**
   * Send JSON payload to TracePrompt ingest.
   * Throws on network failure or HTTP ≥ 400.
   */
  async post(path: string, body: unknown, retries = 5): Promise<void> {
    await sendJson({ path, body, retries, method: "POST" });
  },
};

/* ---------- Internal helper -------------------------------------- */
async function sendJson(opts: PostOptions): Promise<void> {
  const { ingestUrl, apiKey } = ConfigManager.cfg;
  const url = new URL(opts.path, ingestUrl).toString();

  await retry(async () => {
    const res = await fetch(url, {
      method: opts.method ?? "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "traceprompt-sdk/0.1.0",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(opts.body),
      // TLS 1.3 is on by default in Node ≥ 18; no extra options needed.
    });

    if (res.status >= 400) {
      const msg = await res.text();
      throw new Error(`TracePrompt: HTTP ${res.status} – ${msg}`);
    }
  }, opts.retries ?? 5);
}
