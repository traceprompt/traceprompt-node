export interface TracePromptInit {
  dataDir?: string;
  apiKey: string;
  cmkArn?: string; // Optional - can be auto-resolved from API key
  ingestUrl: string;
  batchSize?: number;
  flushIntervalMs?: number;
  staticMeta?: Record<string, unknown>;
  logLevel?: "error" | "warn" | "info" | "verbose" | "debug" | "silly";
}

export interface WrapOpts {
  modelVendor: "openai" | "anthropic" | "grok" | "local";
  modelName: string;
  userId?: string;
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
