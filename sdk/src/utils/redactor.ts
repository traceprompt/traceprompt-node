/* ------------------------------------------------------------------
 * redactor.ts  •  Fast PII masking for @traceprompt/sdk
 * ------------------------------------------------------------------
 *  ➤ Default path = pre-compiled regex (sub-millisecond per 5 kB)
 *  ➤ Optional 'smart' path hooks a worker-thread NER engine
 * ------------------------------------------------------------------ */

import type { JSONValue, PiiRedactMode } from "./types";

/* ---------- 1. Regex patterns (case-insensitive) ------------------ */

const emailRx = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ssnRx = /\b\d{3}-\d{2}-\d{4}\b/g;
const cardRx = /\b(?:\d[ -]*?){13,16}\b/g;
const phoneRx =
  /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g;

/* ---------- 2. Fast string masker -------------------------------- */

function maskRegex(str: string): string {
  return str
    .replace(emailRx, "***EMAIL***")
    .replace(ssnRx, "***SSN***")
    .replace(cardRx, "***CARD***")
    .replace(phoneRx, "***PHONE***");
}

/* ---------- 3. Optional smart NER (stub) -------------------------- */

/**
 * Placeholder — if `mode === 'smart'` we off-load to a tiny WASM NER
 * running in a Worker Thread.  For now it just calls the regex pass.
 * Swap in a real spaCy-wasm or Comprehend call later.
 */
function maskSmart(str: string): string {
  // TODO: tokenize + entity-recogniser; replace spans
  return maskRegex(str);
}

/* ---------- 4. Recursive walker – mutates a shallow clone -------- */

export function redact<T extends JSONValue>(
  value: T,
  mode: PiiRedactMode = "regex"
): T {
  if (mode === "off") return value;

  // leaf string
  if (typeof value === "string") {
    return (mode === "regex" ? maskRegex(value) : maskSmart(value)) as T;
  }

  // array
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, mode)) as T;
  }

  // object
  if (value && typeof value === "object") {
    const out: Record<string, JSONValue> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redact(v as JSONValue, mode);
    }
    return out as T;
  }

  // number | boolean | null
  return value;
}
