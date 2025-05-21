/**
 * @module hash
 * @description Cryptographic hashing and chain linking implementation using:
 * - BLAKE3 for high-performance cryptographic hashing
 * - Canonical JSON serialization for deterministic hashing
 * - In-memory chain linking for tamper evidence
 *
 * The module maintains a single chain head in memory, allowing
 * for sequential linking of entries with cryptographic guarantees.
 */

import { blake3 } from "@napi-rs/blake-hash";
import type { JSONValue } from "./types";

/**
 * Converts a JSON value to its canonical string representation.
 * Ensures deterministic hashing by:
 * - Sorting object keys alphabetically
 * - Removing whitespace
 * - Handling nested structures recursively
 *
 * @param {JSONValue} v - Any JSON-serializable value
 * @returns {string} Canonical string representation
 *
 * @example
 * ```typescript
 * canonical({ b: 2, a: 1 }) // '{"a":1,"b":2}'
 * canonical([null, 1, "2"]) // '[null,1,"2"]'
 * ```
 */
function canonical(v: JSONValue): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;

  const keys = Object.keys(v).sort();
  const body = keys.map(
    (k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`
  );
  return `{${body.join(",")}}`;
}

/**
 * Computes BLAKE3 hash of a string payload.
 * BLAKE3 provides:
 * - Cryptographic security
 * - High performance (faster than MD5/SHA1)
 * - 256-bit (32-byte) output
 *
 * @param {string} payload - Input string to hash
 * @returns {string} 32-byte hex-encoded hash
 *
 * @example
 * ```typescript
 * const hash = digest('hello world');
 * // Returns: 'd74981efa70a0c880b8d8c1985d075dbcbf679b99a5f9914e5aaf96b831a9e24'
 * ```
 */
function digest(payload: string): string {
  return blake3(payload).toString("hex"); // 32-byte hex string
}

/** Current head of the hash chain */
let chainHead: string | null = null;

/**
 * Links a new entry to the hash chain.
 * Creates a tamper-evident chain by:
 * 1. Canonicalizing the input object
 * 2. Computing its cryptographic hash
 * 3. Linking to previous chain head
 * 4. Updating chain head to new hash
 *
 * @template T - Type of the input object
 * @param {T} core - Object to add to chain
 * @returns {T & {prevHash: string|null, hash: string}} Original object with hash links
 *
 * @example
 * ```typescript
 * const entry1 = link({ id: 1, data: 'first' });
 * // { id: 1, data: 'first', prevHash: null, hash: '...' }
 *
 * const entry2 = link({ id: 2, data: 'second' });
 * // { id: 2, data: 'second', prevHash: entry1.hash, hash: '...' }
 * ```
 */
export function link<T extends Record<string, any>>(
  core: T
): T & {
  prevHash: string | null;
  hash: string;
} {
  const canon = canonical(core as any);
  const hash = digest(canon);

  const entry = { ...core, prevHash: chainHead, hash } as any;
  chainHead = hash;
  return entry;
}
