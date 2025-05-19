/* ------------------------------------------------------------------
 * hash.ts  •  Canonical JSON + digest helpers for @traceprompt/sdk
 * ------------------------------------------------------------------
 *  ▸ canonicalJSON(...)   – deterministic, key-sorted JSON stringifier
 *  ▸ digest(str)          – BLAKE3 (default) or SHA-256 hex digest
 *  ▸ link(prev, core)     – attach prevHash + hash → LogEntry object
 *
 *  Notes
 *  -----
 *  • @napi-rs/blake-hash exposes algorithm helpers directly
 *      const hex = blake3("data").toString('hex')
 *  • SHA-256 path uses Node’s built-in crypto for FIPS compliance
 *  • Canonical JSON ensures identical hashes across platforms
 * ------------------------------------------------------------------ */

import { createHash as createNodeHash } from "node:crypto";
import { blake3 } from "@napi-rs/blake-hash";

import { settings } from "./state";
import type { JSONValue, LogEntry } from "./types";

/* ---------- 1. Canonical JSON serializer -------------------------- *
 * Recursively serialises objects/arrays with keys sorted A→Z.
 * Guarantees stable output so hash(entry) is deterministic.
 * ------------------------------------------------------------------ */
export function canonicalJSON(val: JSONValue): string {
  // primitives
  if (val === null || typeof val !== "object") return JSON.stringify(val);

  // arrays
  if (Array.isArray(val)) return `[${val.map(canonicalJSON).join(",")}]`;

  // objects
  const keys = Object.keys(val).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJSON((val as any)[k])}`)
    .join(",");
  return `{${body}}`;
}

/* ---------- 2. Digest helper -------------------------------------- *
 * Chooses algorithm per runtime config.
 *  • BLAKE3 ≈ 3× faster than SHA-256 on small inputs (<10 kB)
 *  • SHA-256 path keeps FIPS-friendly option available
 * ------------------------------------------------------------------ */
export function digest(payload: string): string {
  if (settings.hashAlgo === "blake3") {
    // @napi-rs/blake-hash returns a Buffer → hex string
    return blake3(payload).toString("hex");
  }
  // fallback SHA-256 via Node crypto
  return createNodeHash("sha256").update(payload).digest("hex");
}

/* ---------- 3. Attach hash-chain metadata ------------------------- *
 * Returns a full LogEntry with prevHash + new hash.
 * Used by sdk/wrapper right before enqueue().
 * ------------------------------------------------------------------ */
export function link(
  prevHash: string | null,
  core: Omit<LogEntry, "prevHash" | "hash">
): LogEntry {
  const canon = canonicalJSON(core as any);
  const hash = digest(canon);

  return {
    ...core,
    prevHash,
    hash,
  };
}
