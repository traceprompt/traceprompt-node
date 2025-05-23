/**
 * crypto/hasher.ts
 * ------------------------------------------------------
 * Lightweight wrapper around the native `blake3` module.
 * Exposes a single helper that returns a 32-byte hex
 * digest suitable for Merkle tree leaves or audit chains.
 * ------------------------------------------------------
 */

import { blake3 } from "@napi-rs/blake-hash";

/**
 * Compute a BLAKE3 hash for a given payload.
 *
 * @param data  UTF-8 string, Buffer, or undefined
 * @returns     64-char lowercase hex string (32 bytes)
 */
export function computeLeaf(data: string | Buffer | undefined): string {
  // Handle undefined case (e.g., from stringify failures)
  if (data === undefined) {
    data = "null";
  }
  // napi-rs helper accepts string | Uint8Array
  return blake3(data).toString("hex");
}
