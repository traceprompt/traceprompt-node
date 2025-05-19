/* ------------------------------------------------------------------
 * types.ts  •  Centralised TypeScript types for @traceprompt/sdk
 * ------------------------------------------------------------------ */

/** Redaction strategy */
export type PiiRedactMode = "off" | "regex" | "smart";

/** Hash algorithm choices (extendable) */
export type HashAlgo = "blake3" | "sha256";

/** SDK initialisation options */
export interface InitOptions {
  /** SaaS / ingest API key */
  apiKey: string;

  /** PII redaction strategy (default: 'regex') */
  piiRedact?: PiiRedactMode;

  /** Maximum entries queued in RAM before spill to WAL (default: 100) */
  batchSize?: number;

  /** Flush cadence in milliseconds (default: 50 ms) */
  flushIntervalMs?: number;

  /** Algorithm used for per-entry digest (default: 'blake3') */
  hashAlgo?: HashAlgo;

  /** Write-ahead-log path; set falsy to disable WAL */
  walPath?: string | false;

  /** Anchor cadence (e.g. '1h', '5m'); undefined disables anchoring */
  anchorInterval?: string;

  /** mTLS / TLS client cert settings for /logs calls */
  tls?: {
    ca?: string; // CA bundle path or PEM string
    cert?: string; // client certificate
    key?: string; // client private key
    mtls?: boolean; // default: false
  };
}

/* ------------------------------------------------------------------
 * Log-entry schema (after redaction)
 * ------------------------------------------------------------------ */

/** Canonical JSON value used inside a prompt or response */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JSONValue[]
  | { [k: string]: JSONValue };

/** Core audit-log record */
export interface LogEntry {
  /** Unix epoch ms */
  ts: number;

  /** Redacted prompt body (developer's original input) */
  prompt: JSONValue;

  /** Redacted LLM response */
  response: JSONValue;

  /** Latency & model metadata injected by the SDK */
  meta: {
    latency_ms: number;
    model?: string;
    endpoint?: string;
    userId?: string;
    [k: string]: JSONValue; // extensible enrichment hook
  };

  /** Hash of *previous* entry in the chain (null for genesis) */
  prevHash: string | null;

  /** SHA-256 / BLAKE3 digest of this entry's canonical JSON */
  hash: string;
}

/** Payload sent by the flusher; an ordered batch of entries */
export type BatchPayload = LogEntry[];

/* ------------------------------------------------------------------
 * Internal state used by ring buffer & chain tracker
 * ------------------------------------------------------------------ */

/** Mutable runtime state kept in the SDK singleton */
export interface RuntimeState {
  config: Required<InitOptions>;
  /** Circular buffer holding unflushed entries */
  buffer: LogEntry[];
  /** Index of the next slot to write into buffer */
  head: number;
  /** Index of the next slot to flush from buffer */
  tail: number;
  /** Latest chain head hash (persisted across restarts via WAL) */
  chainHead: string | null;
}
