import { performance } from "node:perf_hooks";
import { initTracePrompt as initCfgAsync, ConfigManager } from "./config";
import { encryptBuffer } from "./crypto/encryptor";
import { computeLeaf } from "./crypto/hasher";
import { countTokens } from "./utils/tokenCounter";
import { PersistentBatcher as Batcher } from "./queue/persistentBatcher";
const stringify = require("json-stable-stringify") as (v: any) => string;
import type { TracePromptInit, WrapOpts } from "./types";

import { registry } from "./metrics";
import { Histogram } from "prom-client";
import { analyzePiiInPromptResponse } from "./utils/piiDetector";

const wrapperLatencyHist = new Histogram({
  name: "traceprompt_llm_wrapper_latency_ms",
  help: "End‑to‑end latency from prompt send to response receive in the SDK wrapper (ms)",
  buckets: [50, 100, 250, 500, 1000, 2000, 5000],
  registers: [registry],
});

// Map PII detector risk levels to API expected values
function mapRiskLevelToApiEnum(
  riskLevel: "general" | "sensitive" | "critical"
): "low" | "medium" | "high" | "critical" {
  switch (riskLevel) {
    case "general":
      return "low";
    case "sensitive":
      return "medium";
    case "critical":
      return "critical";
    default:
      return "low";
  }
}

export async function initTracePrompt(
  cfg?: Partial<TracePromptInit>
): Promise<void> {
  await initCfgAsync(cfg);
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

    wrapperLatencyHist.observe(t1 - t0);

    const responseText =
      typeof result === "string" ? result : JSON.stringify(result);
    const piiAnalysis = await analyzePiiInPromptResponse(prompt, responseText);

    const plaintextJson = JSON.stringify({
      prompt,
      response: result,
    });

    const enc = await encryptBuffer(Buffer.from(plaintextJson, "utf8"));

    const payload = {
      ...staticMeta,
      orgId: ConfigManager.cfg.orgId,
      modelVendor: meta.modelVendor,
      modelName: meta.modelName,
      userId: meta.userId,
      ts_client: new Date().toISOString(),
      latency_ms: +(t1 - t0).toFixed(2),
      prompt_tokens: countTokens(prompt),
      response_tokens: countTokens(responseText),
      pii_detected: piiAnalysis.overallPiiDetected,
      pii_types: piiAnalysis.allPiiTypes,
      pii_risk_level:
        piiAnalysis.prompt.piiDetected || piiAnalysis.response.piiDetected
          ? piiAnalysis.prompt.riskLevel === "critical" ||
            piiAnalysis.response.riskLevel === "critical"
            ? "critical"
            : piiAnalysis.prompt.riskLevel === "sensitive" ||
              piiAnalysis.response.riskLevel === "sensitive"
            ? "medium"
            : "low"
          : "low",
      prompt_pii_detected: piiAnalysis.prompt.piiDetected,
      prompt_pii_types: piiAnalysis.prompt.piiTypes,
      prompt_pii_risk_level: mapRiskLevelToApiEnum(
        piiAnalysis.prompt.riskLevel
      ),
      response_pii_detected: piiAnalysis.response.piiDetected,
      response_pii_types: piiAnalysis.response.piiTypes,
      response_pii_risk_level: mapRiskLevelToApiEnum(
        piiAnalysis.response.riskLevel
      ),
      enc,
    };

    const leafHash = computeLeaf(stringify(payload));
    Batcher.enqueue({ payload, leafHash });

    return result;
  };
}
