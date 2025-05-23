export interface TracePromptInit {
  tenantId: string;
  cmkArn: string;
  ingestUrl: string;
  batchSize?: number;
  flushIntervalMs?: number;
  staticMeta?: Record<string, unknown>;
}

export interface WrapOpts {
  modelVendor: "openai" | "anthropic" | "grok" | "local";
  modelName: string;
  userId?: string;
}

export interface EncryptedBundle {
  ciphertext: string; // everything in one base64 blob
  encryptedDataKey: string; // wrapped data-key, base64
  suiteId?: number; // optional – keep if you like
}

export interface QueueItem {
  payload: Record<string, unknown> & { enc: EncryptedBundle };
  leafHash: string;
}

export interface EncryptedBundle {
  /** Complete ciphertext including header, IV & auth-tag (base64) */
  ciphertext: string;
  /** The wrapped data-key for this record (base64)               */
  encryptedDataKey: string;
  /** Optional – algorithmSuiteId lets you verify params on read  */
  algoSuiteId: number;
}
