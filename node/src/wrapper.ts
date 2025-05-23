/**
 * wrapper.ts
 * ------------------------------------------------------
 * Core SDK logic that:
 *   1. Accepts runtime config via initTracePrompt().
 *   2. Wraps any LLM call so that:
 *        • prompt + response are encrypted client-side
 *        • metadata collected (latency, token counts, etc.)
 *        • payload + BLAKE3 hash enqueued for batch flush
 * ------------------------------------------------------
 */

import { performance } from "node:perf_hooks";
import { initTracePrompt as initCfg, ConfigManager } from "./config";
import { encryptBuffer } from "./crypto/encryptor";
import { computeLeaf } from "./crypto/hasher";
import { countTokens } from "./utils/tokenCounter";
import { Batcher } from "./queue/batcher";
const stringify = require("json-stable-stringify") as (v: any) => string;
import type { TracePromptInit, WrapOpts, EncryptedBundle } from "./types";

/* ------------------------------------------------------------------ */
/* 1. Public: initialise SDK                                          */
/* ------------------------------------------------------------------ */
export function initTracePrompt(cfg?: Partial<TracePromptInit>): void {
  initCfg(cfg);
}

/* ------------------------------------------------------------------ */
/* 2. Public: wrap any async LLM call                                 */
/* ------------------------------------------------------------------ */
export function wrapLLM<P extends Record<string, any>, R>(
  originalFn: (prompt: string, params?: P) => Promise<R>,
  meta: WrapOpts
): (prompt: string, params?: P) => Promise<R> {
  const staticMeta = ConfigManager.cfg.staticMeta;

  return async function wrapped(prompt: string, params?: P): Promise<R> {
    /* ---------- 1. Call the underlying model -------------------- */
    const t0 = performance.now();
    const result = await originalFn(prompt, params);
    const t1 = performance.now();

    /* ---------- 2. Assemble plaintext JSON ---------------------- */
    const plaintextJson = JSON.stringify({
      prompt,
      response: result,
    });

    /* ---------- 3. Client-side encryption ----------------------- */
    const enc: EncryptedBundle = await encryptBuffer(
      Buffer.from(plaintextJson, "utf8")
    );

    /* ---------- 4. Build metadata payload ----------------------- */
    const payload = {
      ...staticMeta,
      tenantId: ConfigManager.cfg.tenantId,
      modelVendor: meta.modelVendor,
      modelName: meta.modelName,
      userId: meta.userId,
      ts_client: new Date().toISOString(),
      latency_ms: +(t1 - t0).toFixed(2),
      prompt_tokens: countTokens(prompt),
      response_tokens: countTokens(
        typeof result === "string" ? result : JSON.stringify(result)
      ),
      enc,
    };

    /* ---------- 5. Compute hash & enqueue ----------------------- */
    const leafHash = computeLeaf(stringify(payload));
    Batcher.enqueue({ payload, leafHash });

    /* ---------- 6. Return original result ----------------------- */
    return result;
  };
}
