/**
 * wrapper.ts
 * ----------------------------------------------
 * • initTracePrompt()  – one-time config loader
 * • wrapLLM()          – decorator that captures
 *   prompt / response, encrypts, hashes, queues.
 * ----------------------------------------------
 */

import { performance } from "node:perf_hooks";
import { ConfigManager } from "./config";
import { encryptBuffer } from "./crypto/encryptor";
import { computeLeaf } from "./crypto/hasher";
import { countTokens } from "./utils/tokenCounter";
import { Batcher } from "./queue/batcher";

import type { TracePromptInit, WrapOpts, EncryptedBundle } from "./types";

/* ------------------------------------------------------------------ */
/* 1. Public: initialise SDK                                          */
/* ------------------------------------------------------------------ */
export function initTraceprompt(cfg?: Partial<TracePromptInit>): void {
  ConfigManager.load(cfg);
}

/* ------------------------------------------------------------------ */
/* 2. Public: wrap any async llm(prompt, params) call                 */
/* ------------------------------------------------------------------ */
export function wrap<P extends Record<string, any>, R>(
  llmCall: (prompt: string, params?: P) => Promise<R>,
  meta: WrapOpts
): (prompt: string, params?: P) => Promise<R> {
  /* ------------- Decorated function ------------------------------ */
  return async function (prompt: string, params?: P): Promise<R> {
    const t0 = performance.now();
    const result = await llmCall(prompt, params);
    const t1 = performance.now();

    /* ---------- Build plaintext event object --------------------- */
    const plaintextJSON = JSON.stringify({
      prompt,
      response: result,
    });

    /* ---------- Encrypt (client-side envelope) ------------------- */
    const enc: EncryptedBundle = await encryptBuffer(
      Buffer.from(plaintextJSON, "utf8")
    );

    /* ---------- Assemble payload sent to TracePrompt ------------- */
    const payload = {
      tenantId: ConfigManager.cfg.tenantId,
      modelVendor: meta.modelVendor,
      modelName: meta.modelName,
      userId: meta.userId ?? undefined,
      ts_client: new Date().toISOString(),
      latency_ms: +(t1 - t0).toFixed(2),
      prompt_tokens: countTokens(prompt),
      response_tokens: countTokens(
        typeof result === "string" ? result : JSON.stringify(result)
      ),
      enc, // <- ciphertext bundle
    };

    /* ---------- Hash and queue ----------------------------------- */
    const leafHash = computeLeaf(JSON.stringify(payload));
    Batcher.enqueue({ payload, leafHash });

    /* ---------- Return the LLM result untouched ------------------ */
    return result;
  };
}
