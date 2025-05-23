/**
 * types.ts
 * ------------------------------------------------------
 * Central type declarations used across the TracePrompt
 * SDK.  They are re-exported in `src/index.ts` so that
 * downstream applications can `import type { … }`.
 * ------------------------------------------------------
 */

/* ========== Public configuration & wrapper types ========== */

/** Values accepted by initTracePrompt(). */
export interface TracePromptInit {
  /** Unique ID for the tenant / customer. */
  tenantId: string;

  /** API key for authentication with the TracePrompt ingest service. */
  apiKey: string;

  /**
   * Customer-managed KMS key ARN.
   * Use literal `"local-dev"` in local mode and provide
   * a hex-encoded 32-byte key in LOCAL_DEV_KEK.
   */
  cmkArn: string;

  /** HTTPS endpoint for batch ingestion. */
  ingestUrl: string;

  /** Flush batch when queue reaches this size (default 25). */
  batchSize?: number;

  /** Flush at least this often in milliseconds (default 2 000 ms). */
  flushIntervalMs?: number;

  /** Arbitrary metadata appended to every event. */
  staticMeta?: Record<string, unknown>;
}

/** Extra metadata supplied when wrapping an LLM function. */
export interface WrapOpts {
  modelVendor: "openai" | "anthropic" | "grok" | "local";
  modelName: string;
  /** Optional user identifier for audit correlation. */
  userId?: string;
}

/* ========== Encryption payload ========== */

/**
 * Minimal envelope returned by crypto/encryptor.ts.
 * We store only the full ciphertext blob plus the
 * wrapped data-key (and, optionally, algorithm id).
 */
export interface EncryptedBundle {
  ciphertext: string; // base64
  encryptedDataKey: string; // base64
  suiteId?: number; // optional: algorithm suite identifier
}

/* ========== Internal queue item ========== */

export interface QueueItem {
  /** JSON payload: metadata + `enc` bundle. */
  payload: Record<string, unknown> & { enc: EncryptedBundle };
  /** Hex-encoded BLAKE3 leaf hash of the payload. */
  leafHash: string;
}
