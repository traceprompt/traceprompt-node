import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { initTracePrompt as initCfgAsync, ConfigManager } from "./config";
import { encryptBuffer } from "./crypto/encryptor";
import { computeLeaf } from "./crypto/hasher";
import { countTokens } from "./utils/tokenCounter";
import { PersistentBatcher as Batcher } from "./queue/persistentBatcher";
const stringify = require("json-stable-stringify") as (v: any) => string;
import type { TracepromptInit, WrapOpts, SpanContext } from "./types";

import { registry } from "./metrics";
import { Histogram } from "prom-client";

// Simple context management for trace correlation
let currentContext: SpanContext | null = null;

// Trace-level event indexing for deterministic ordering
const traceEventCounters = new Map<string, number>();

// Integrity chain management
const tracePreviousHashes = new Map<string, string>();

function getNextEventIndex(traceId: string): number {
  const current = traceEventCounters.get(traceId) || 0;
  const next = current + 1;
  traceEventCounters.set(traceId, next);
  return next;
}

function getPreviousEventHash(traceId: string): string | undefined {
  return tracePreviousHashes.get(traceId);
}

function updatePreviousEventHash(traceId: string, eventHash: string): void {
  tracePreviousHashes.set(traceId, eventHash);
}

export function startSpan(opts: WrapOpts): SpanContext {
  const spanId = randomUUID();
  const traceId = opts.traceId || currentContext?.traceId || randomUUID();

  // Special handling for AgentRun - should be root span
  const isAgentRun = opts.spanKind === "AgentRun";
  const parentSpanId = isAgentRun
    ? undefined
    : opts.parentSpanId || currentContext?.spanId;

  const eventIndex = getNextEventIndex(traceId);

  const context: SpanContext = {
    spanId,
    traceId,
    parentSpanId,
    eventIndex,
  };

  // Set as current context for nested operations
  currentContext = context;
  return context;
}

export function getCurrentContext(): SpanContext | null {
  return currentContext;
}

// Helper function for logging tool spans with proper metadata
async function logToolSpan(options: {
  context: SpanContext;
  spanKind: "ToolCall" | "ToolResult";
  input?: any;
  result?: any;
  toolName: string;
  toolVersion?: string;
  latency: number;
  status: "ok" | "error" | "timeout";
  error?: string;
}): Promise<void> {
  const {
    context,
    spanKind,
    input,
    result,
    toolName,
    toolVersion,
    latency,
    status,
    error,
  } = options;
  const staticMeta = ConfigManager.cfg.staticMeta;

  // Determine what to encrypt based on span type
  const dataToEncrypt = spanKind === "ToolCall" ? { input } : { result };
  const plaintextJson = JSON.stringify(dataToEncrypt);

  // Compute content hashes for audit proofs using existing crypto
  const plaintextBuffer = Buffer.from(plaintextJson, "utf8");
  const plaintextHash = computeLeaf(plaintextBuffer);

  const enc = await encryptBuffer(plaintextBuffer);

  // Compute ciphertext hash using existing crypto (hash the base64 string itself)
  const ciphertextHash = computeLeaf(enc.ciphertext);

  // Create appropriate text for token counting
  const inputText = input
    ? typeof input === "string"
      ? input
      : JSON.stringify(input)
    : "";
  const resultText = result
    ? typeof result === "string"
      ? result
      : JSON.stringify(result)
    : "";

  // Get previous event hash for integrity chain
  const prevEventHash = getPreviousEventHash(context.traceId);

  const payload = {
    ...staticMeta,
    orgId: ConfigManager.cfg.orgId,
    // Span identification
    span_id: context.spanId,
    trace_id: context.traceId,
    parent_span_id: context.parentSpanId,
    span_kind: spanKind,
    // Deterministic ordering
    event_index: context.eventIndex,
    // Integrity chain
    prev_event_hash: prevEventHash,
    // Content integrity hashes for audit proofs
    plaintext_hash: plaintextHash,
    ciphertext_hash: ciphertextHash,
    // Audit & compliance fields
    schema_version: "1.0.0",
    ts_client: new Date().toISOString(),
    ts_server: new Date().toISOString(), // Will be overridden by server
    retention_class: "standard",
    policy_checks: [],
    // Common fields
    latency_ms: +latency.toFixed(2),
    status: status,
    // Tool-specific fields
    tool_name: toolName,
    tool_version: toolVersion,
    // Token counting
    prompt_tokens: countTokens(inputText),
    response_tokens: countTokens(resultText),
    // Error info
    ...(error && { error }),
    enc,
  };

  const leafHash = computeLeaf(stringify(payload));

  // Update the previous hash for next event in this trace
  updatePreviousEventHash(context.traceId, leafHash);

  Batcher.enqueue({ payload, leafHash });
}

// Helper function to extract actual content from LLM responses
function extractResponseContent(result: any): string {
  if (typeof result === "string") {
    return result;
  }

  // OpenAI chat completion format
  if (result?.choices?.[0]?.message?.content) {
    return result.choices[0].message.content;
  }

  // Anthropic format
  if (result?.content?.[0]?.text) {
    return result.content[0].text;
  }

  // Generic content field
  if (result?.content && typeof result.content === "string") {
    return result.content;
  }

  // Fallback to stringification only if no recognizable content structure
  return JSON.stringify(result);
}

// Helper function to extract token usage from provider responses
function extractTokenUsage(result: any): {
  promptTokens: number;
  responseTokens: number;
} {
  // OpenAI format
  if (result?.usage) {
    return {
      promptTokens: result.usage.prompt_tokens || 0,
      responseTokens: result.usage.completion_tokens || 0,
    };
  }

  // Anthropic format
  if (result?.usage) {
    return {
      promptTokens: result.usage.input_tokens || 0,
      responseTokens: result.usage.output_tokens || 0,
    };
  }

  // Google Gemini format
  if (result?.usageMetadata) {
    return {
      promptTokens: result.usageMetadata.promptTokenCount || 0,
      responseTokens: result.usageMetadata.candidatesTokenCount || 0,
    };
  }

  // Fallback to manual counting if no usage data available
  const responseText = extractResponseContent(result);
  return {
    promptTokens: 0, // Can't determine without input
    responseTokens: countTokens(responseText),
  };
}

// Helper function to extract provider request IDs
function extractRequestIds(result: any): {
  providerRequestId?: string;
  modelRequestId?: string;
} {
  // OpenAI format - they include request ID in response headers (would need response object)
  // For now, extract from response body if available
  if (result?.id) {
    return {
      modelRequestId: result.id, // e.g., "chatcmpl-ABC123"
    };
  }

  // Anthropic format
  if (result?.id) {
    return {
      modelRequestId: result.id,
    };
  }

  // Google Gemini format
  if (result?.candidates?.[0]?.index !== undefined) {
    return {
      modelRequestId: `gemini-${Date.now()}`, // Gemini doesn't provide request ID
    };
  }

  return {};
}

const wrapperLatencyHist = new Histogram({
  name: "traceprompt_llm_wrapper_latency_ms",
  help: "End‑to‑end latency from prompt send to response receive in the SDK wrapper (ms)",
  buckets: [50, 100, 250, 500, 1000, 2000, 5000],
  registers: [registry],
});

export async function init(cfg?: Partial<TracepromptInit>): Promise<void> {
  await initCfgAsync(cfg);
}

export function wrap<I = string, P extends Record<string, any> = {}, R = any>(
  originalFn: (input: I, params?: P) => Promise<R>,
  meta: WrapOpts
): (input: I, params?: P) => Promise<R> {
  const staticMeta = ConfigManager.cfg.staticMeta;
  const spanKind = meta.spanKind || "ModelCall";

  return async function wrapped(input: I, params?: P): Promise<R> {
    const spanContext = startSpan(meta);
    const t0 = performance.now();
    const result = await originalFn(input, params);
    const t1 = performance.now();

    wrapperLatencyHist.observe(t1 - t0);

    // Extract actual content from LLM response instead of stringifying entire object
    const responseText = extractResponseContent(result);
    const inputText = typeof input === "string" ? input : JSON.stringify(input);

    // Extract token usage from provider response (preferred) or fallback to manual counting
    const tokenUsage =
      spanKind === "ModelCall"
        ? extractTokenUsage(result)
        : {
            promptTokens: countTokens(inputText),
            responseTokens: countTokens(responseText),
          };

    // Determine usage source for audit trail
    const usageSource =
      spanKind === "ModelCall" && (result as any)?.usage ? "provider" : "local";
    const usageMethod = usageSource === "local" ? "tiktoken" : undefined;

    // Extract request IDs for correlation with provider logs
    const requestIds =
      spanKind === "ModelCall" ? extractRequestIds(result) : {};

    // Generate client request ID for this trace
    const clientRequestId = `trace-${spanContext.traceId}-${spanContext.eventIndex}`;

    const plaintextJson = JSON.stringify({
      input,
      response: result,
    });

    // Compute content hashes for audit proofs using existing crypto
    const plaintextBuffer = Buffer.from(plaintextJson, "utf8");
    const plaintextHash = computeLeaf(plaintextBuffer);

    const enc = await encryptBuffer(plaintextBuffer);

    // Compute ciphertext hash using existing crypto (hash the base64 string itself)
    const ciphertextHash = computeLeaf(enc.ciphertext);

    // Get previous event hash for integrity chain
    const prevEventHash = getPreviousEventHash(spanContext.traceId);

    const payload = {
      ...staticMeta,
      orgId: ConfigManager.cfg.orgId,
      // Span identification
      span_id: spanContext.spanId,
      trace_id: spanContext.traceId,
      parent_span_id: spanContext.parentSpanId,
      span_kind: spanKind,
      // Deterministic ordering
      event_index: spanContext.eventIndex,
      // Integrity chain
      prev_event_hash: prevEventHash,
      // Request correlation
      client_request_id: clientRequestId,
      ...(requestIds.providerRequestId && {
        provider_request_id: requestIds.providerRequestId,
      }),
      ...(requestIds.modelRequestId && {
        model_request_id: requestIds.modelRequestId,
      }),
      // Content integrity hashes for audit proofs
      plaintext_hash: plaintextHash,
      ciphertext_hash: ciphertextHash,
      // Audit & compliance fields
      schema_version: "1.0.0",
      ts_client: new Date().toISOString(),
      ts_server: new Date().toISOString(), // Will be overridden by server
      retention_class: "standard",
      policy_checks: [], // TODO: implement policy checks
      // Common fields
      userId: meta.userId,
      latency_ms: +(t1 - t0).toFixed(2),
      prompt_tokens: tokenUsage.promptTokens,
      response_tokens: tokenUsage.responseTokens,
      usage_source: usageSource,
      ...(usageMethod && { usage_method: usageMethod }),
      status: "ok", // TODO: capture actual status
      // LLM-specific fields (for ModelCall spans)
      modelVendor: meta.modelVendor,
      modelName: meta.modelName,
      // Tool-specific fields (for ToolCall spans)
      tool_name: meta.toolName,
      tool_version: meta.toolVersion,
      // Agent-specific fields (for AgentRun spans)
      agent_name: meta.agentName,
      step_index: meta.stepIndex,
      // Agent identity fields (only for AgentRun spans)
      ...(spanKind === "AgentRun" && {
        agent_id: ConfigManager.cfg.agent?.id || randomUUID(), // Stable agent ID from config or generate new
        agent_version: meta.agentVersion || "1.0.0", // Agent version from metadata or default
        agent_kind: meta.agentKind || "custom", // Agent type from metadata or default
        agent_fingerprint: computeLeaf(
          `${meta.agentName}-${meta.agentVersion || "1.0.0"}`
        ), // Fingerprint for agent+version
        policy_profile: meta.policyProfile || "prod/default", // Policy profile from metadata or default
      }),
      enc,
    };

    const leafHash = computeLeaf(stringify(payload));

    // Update the previous hash for next event in this trace
    updatePreviousEventHash(spanContext.traceId, leafHash);

    Batcher.enqueue({ payload, leafHash });

    return result;
  };
}

// Enhanced tool wrapper that emits both ToolCall and ToolResult spans
export function wrapTool<T, R>(
  toolFn: (input: T) => Promise<R>,
  toolName: string,
  toolVersion?: string
) {
  return async function wrappedTool(input: T): Promise<R> {
    const staticMeta = ConfigManager.cfg.staticMeta;

    // Create ToolCall span first
    const toolCallContext = startSpan({
      spanKind: "ToolCall",
      toolName,
      toolVersion,
    });

    const t0 = performance.now();
    let status: "ok" | "error" | "timeout" = "ok";
    let result: R | undefined;
    let error: Error | undefined;

    try {
      result = await toolFn(input);
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      status = "error";
      throw error;
    } finally {
      const t1 = performance.now();
      const latency = t1 - t0;

      // Log ToolCall span (input only)
      await logToolSpan({
        context: toolCallContext,
        spanKind: "ToolCall",
        input,
        result: undefined, // ToolCall only has input
        toolName,
        toolVersion,
        latency,
        status,
        error: error?.message,
      });

      // Log ToolResult span (output + status)
      if (!error) {
        const toolResultContext = startSpan({
          spanKind: "ToolResult",
          toolName,
          toolVersion,
          parentSpanId: toolCallContext.spanId,
        });

        await logToolSpan({
          context: toolResultContext,
          spanKind: "ToolResult",
          input: undefined, // ToolResult only has output
          result,
          toolName,
          toolVersion,
          latency: 0, // ToolResult is instantaneous after ToolCall
          status,
        });
      }
    }

    return result!; // Will only reach here if no error occurred
  };
}

// Specialized wrapper for agent functions (creates root span)
export function wrapAgent<T, R>(
  agentFn: (input: T) => Promise<R>,
  agentName?: string,
  options?: {
    agentVersion?: string;
    agentKind?: string;
    policyProfile?: string;
  }
) {
  return async (input: T): Promise<R> => {
    const newTraceId = randomUUID();

    // Reset event counters and hash chain for new trace
    traceEventCounters.set(newTraceId, 0);
    tracePreviousHashes.delete(newTraceId);

    // Use configuration defaults when not provided
    const agentDefaults = ConfigManager.cfg.agent || {};

    const resolvedAgentName =
      agentName || agentDefaults.name || "default_agent";
    const resolvedAgentVersion =
      options?.agentVersion || agentDefaults.version || "1.0.0";
    const resolvedAgentKind =
      options?.agentKind || agentDefaults.kind || "custom";
    const resolvedPolicyProfile =
      options?.policyProfile || agentDefaults.policy_profile || "default";

    // Create AgentRun span context (as root span)
    const agentSpanContext = startSpan({
      spanKind: "AgentRun",
      agentName: resolvedAgentName,
      agentVersion: resolvedAgentVersion,
      agentKind: resolvedAgentKind,
      policyProfile: resolvedPolicyProfile,
      traceId: newTraceId,
    });

    // Emit AgentRun span immediately (at START of agent execution)
    await logAgentRunSpan({
      context: agentSpanContext,
      input,
      agentName: resolvedAgentName,
      agentVersion: resolvedAgentVersion,
      agentKind: resolvedAgentKind,
      policyProfile: resolvedPolicyProfile,
    });

    // Execute the agent function within the trace context
    const startTime = performance.now();
    let result: R | undefined;
    let error: Error | undefined;

    try {
      result = await agentFn(input);
      return result;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      throw error;
    } finally {
      const endTime = performance.now();
      // Update the AgentRun span with final result/status when complete
      await updateAgentRunSpan({
        context: agentSpanContext,
        result: error ? undefined : result,
        error,
        latency: endTime - startTime,
      });
    }
  };
}

// Helper function to log AgentRun span at start
async function logAgentRunSpan(options: {
  context: SpanContext;
  input: any;
  agentName: string;
  agentVersion: string;
  agentKind: string;
  policyProfile: string;
}) {
  const { context, input, agentName, agentVersion, agentKind, policyProfile } =
    options;

  // Encrypt the input for the AgentRun span
  const plaintextJson = JSON.stringify({ input });
  const plaintextBuffer = Buffer.from(plaintextJson, "utf8");
  const plaintextHash = computeLeaf(plaintextBuffer);

  const enc = await encryptBuffer(plaintextBuffer);
  const ciphertextHash = computeLeaf(enc.ciphertext);

  // For AgentRun, prev_event_hash should be null (it's the root)
  const prevEventHash = null;

  // Generate client request ID for this trace
  const clientRequestId = `trace-${context.traceId}-${context.eventIndex}`;

  const payload = {
    orgId: ConfigManager.cfg.orgId,
    span_id: context.spanId,
    trace_id: context.traceId,
    parent_span_id: context.parentSpanId,
    span_kind: "AgentRun",
    event_index: context.eventIndex,
    prev_event_hash: prevEventHash,
    client_request_id: clientRequestId,
    plaintext_hash: plaintextHash,
    ciphertext_hash: ciphertextHash,
    schema_version: "1.0.0",
    ts_client: new Date().toISOString(),
    ts_server: new Date().toISOString(),
    retention_class: "standard",
    policy_checks: [],
    userId: "example-user-123", // TODO: make configurable
    latency_ms: 0, // Will be updated later
    prompt_tokens: countTokens(
      typeof input === "string" ? input : JSON.stringify(input)
    ),
    response_tokens: 0, // Will be updated later
    usage_source: "local",
    usage_method: "tiktoken",
    status: "in_progress", // Will be updated to "ok" or "error"
    agent_name: agentName,
    agent_id: ConfigManager.cfg.agent?.id || randomUUID(),
    agent_version: agentVersion,
    agent_kind: agentKind,
    agent_fingerprint: computeLeaf(`${agentName}-${agentVersion}`),
    policy_profile: policyProfile,
    enc,
  };

  const leafHash = computeLeaf(stringify(payload));

  // Update integrity chain
  updatePreviousEventHash(context.traceId, leafHash);

  // Emit to queue
  Batcher.enqueue({ payload, leafHash });
}

// Helper function to update AgentRun span when complete
async function updateAgentRunSpan(options: {
  context: SpanContext;
  result?: any;
  error?: Error;
  latency: number;
}) {
  // For now, we'll emit a completion event
  // In the future, this could update the existing span record
  // or emit a separate "AgentComplete" event
  // NOTE: For simplicity, we're not implementing span updates yet
  // The initial AgentRun span contains the start state
  // A production implementation might emit a completion event or update the span
}
