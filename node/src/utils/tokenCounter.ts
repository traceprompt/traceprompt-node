/**
 * utils/tokenCounter.ts
 * ------------------------------------------------------
 * “Good-enough” token counter that works out of the box
 * yet lets callers swap in their own tokenizer.
 *
 * Default behaviour:
 *   • Tries @dqbd/tiktoken with the `cl100k_base` model
 *     (same BPE used by GPT-3.5/4 and Anthropic Claude 3).
 *   • Falls back to a fast heuristic: `≈ words × 1.33`.
 *
 * You can override the tokenizer at runtime:
 *
 *   import { setCustomEncoder } from './utils/tokenCounter'
 *   import { encode } from '@some/bpe-lib'
 *
 *   setCustomEncoder(str => encode(str).length)
 * ------------------------------------------------------
 */

let encodeFn: ((s: string) => number) | null = null;

/** Optional: let the host app supply a custom encoder. */
export function setCustomEncoder(fn: (s: string) => number): void {
  encodeFn = fn;
}

/** Main helper – returns token count for a piece of text. */
export function countTokens(text: string): number {
  /* ---------- Prefer user-supplied encoder -------------- */
  if (encodeFn) return encodeFn(text);

  /* ---------- Try tiktoken on first call ---------------- */
  if (maybeInitTiktoken()) {
    return encodeFn!(text);
  }

  /* ---------- Heuristic fallback ------------------------ */
  const words = text.trim().split(/\s+/g).length;
  return Math.ceil(words * 1.33);
}

/* ====================================================== */
/*          Lazy-init tiktoken (one-time attempt)         */
/* ====================================================== */

let triedTiktoken = false;

function maybeInitTiktoken(): boolean {
  if (encodeFn || triedTiktoken) return !!encodeFn;
  triedTiktoken = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { encoding_for_model } = require("@dqbd/tiktoken");
    const enc = encoding_for_model("cl100k_base");
    encodeFn = (s: string): number => enc.encode(s).length;
    return true;
  } catch {
    /* tiktoken not installed or failed to load */
    return false;
  }
}
