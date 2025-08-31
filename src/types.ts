export interface AgentDefaults {
  name?: string;
  id?: string; // Stable UUID across deployments
  version?: string;
  kind?: string;
  policy_profile?: string;
}

export interface TracepromptInit {
  dataDir?: string;
  apiKey: string;
  ingestUrl: string;
  batchSize?: number;
  flushIntervalMs?: number;
  staticMeta?: Record<string, unknown>;
  agent?: AgentDefaults; // Agent identity defaults
  logLevel?: "error" | "warn" | "info" | "verbose" | "debug" | "silly";
}

export interface WrapOpts {
  modelVendor?:
    | "openai"
    | "anthropic"
    | "grok"
    | "gemini"
    | "mistral"
    | "deepseek"
    | "xai"
    | "local"; // Optional for non-LLM spans
  modelName?: string; // Optional for non-LLM spans
  userId?: string;
  spanKind?: SpanKind; // NEW: defaults to "ModelCall"

  // Tool-specific metadata
  toolName?: string; // For ToolCall/ToolResult spans
  toolVersion?: string;

  // Agent-specific metadata
  agentName?: string; // For AgentRun spans
  agentVersion?: string; // Agent version for AgentRun spans
  agentKind?: string; // Agent type (e.g., "custom", "openai-assistant")
  policyProfile?: string; // Policy profile for compliance
  stepIndex?: number; // For AgentStep spans

  // Trace correlation
  traceId?: string; // NEW: for linking spans
  parentSpanId?: string; // NEW: for span hierarchy
}

export interface EncryptedBundle {
  ciphertext: string;
  encryptedDataKey: string;
  suiteId?: number;
}

export interface QueueItem {
  payload: Record<string, unknown> & { enc: EncryptedBundle };
  leafHash: string;
}

// New span types for agent and tool call tracing
export type SpanKind =
  | "ModelCall" // LLM API call
  | "AgentRun" // Top-level agent session (root span)
  | "AgentStep" // Single reasoning iteration
  | "ToolCall" // Tool invocation (input)
  | "ToolResult" // Tool response (output + status)
  | "Retrieval" // RAG/search operation
  | "PolicyCheck" // Compliance validation
  | "HumanFeedback"; // Manual approvals/escalations

// Span context for trace propagation
export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  eventIndex?: number; // Monotonic counter per trace
}
