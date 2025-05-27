import { performance } from "node:perf_hooks";
import { initTracePrompt as initCfg, ConfigManager } from "./config";
import { encryptBuffer } from "./crypto/encryptor";
import { computeLeaf } from "./crypto/hasher";
import { countTokens } from "./utils/tokenCounter";
import { PersistentBatcher as Batcher } from "./queue/persistentBatcher";
const stringify = require("json-stable-stringify") as (v: any) => string;
import type { TracePromptInit, WrapOpts, EncryptedBundle } from "./types";

export function initTracePrompt(cfg?: Partial<TracePromptInit>): void {
  initCfg(cfg);
}

export function wrapLLM<P extends Record<string, any>, R>(
  originalFn: (prompt: string, params?: P) => Promise<R>,
  meta: WrapOpts
): (prompt: string, params?: P) => Promise<R> {
  const staticMeta = ConfigManager.cfg.staticMeta;

  return async function wrapped(prompt: string, params?: P): Promise<R> {
    const t0 = performance.now();
    const result = await originalFn(prompt, params);
    const t1 = performance.now();

    const plaintextJson = JSON.stringify({
      prompt,
      response: result,
    });

    const enc: EncryptedBundle = await encryptBuffer(
      Buffer.from(plaintextJson, "utf8")
    );

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

    const leafHash = computeLeaf(stringify(payload));
    Batcher.enqueue({ payload, leafHash });

    return result;
  };
}
