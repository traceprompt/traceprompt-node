/**
 * @module audit-entry
 * @description Schema and type definitions for tamper-evident audit entries.
 * Defines the core data model for the audit trail, including:
 * - Entry structure and validation
 * - Cryptographic chain linking
 * - Timestamp and latency tracking
 * - PII-safe content fields
 */

import { z } from "zod";

/**
 * Zod schema for validating audit trail entries.
 * Each entry represents one AI interaction with tamper-evidence.
 *
 * @property {string} apiKey - Tenant API key for authentication
 * @property {string} ts - ISO 8601 timestamp of the entry
 * @property {string} prompt - Redacted prompt text (PII removed)
 * @property {string} response - Redacted response text (PII removed)
 * @property {number} latency_ms - Request latency in milliseconds
 * @property {string|null} prevHash - Hash of previous entry in chain (null for first entry)
 * @property {string} hash - BLAKE3 hash of canonicalized entry
 *
 * @example
 * ```typescript
 * const entry = {
 *   apiKey: "tp_123...",
 *   ts: "2024-03-14T12:34:56.789Z",
 *   prompt: "What is 2+2?",
 *   response: "The answer is 4",
 *   latency_ms: 123,
 *   prevHash: "abc123...",
 *   hash: "def456..."
 * };
 *
 * // Validates at runtime
 * const valid = LogEntrySchema.parse(entry);
 * ```
 */
export const LogEntrySchema = z.object({
  apiKey: z.string(),
  ts: z.string(),
  prompt: z.string(),
  response: z.string(),
  latency_ms: z.number(),
  prevHash: z.string().nullable(),
  hash: z.string(),
});

/**
 * Type definition for a validated audit entry.
 * Inferred from the Zod schema to ensure type and runtime validation match.
 *
 * @see {@link LogEntrySchema} for field descriptions and validation rules
 */
export type LogEntry = z.infer<typeof LogEntrySchema>;
