let encodeFn: ((s: string) => number) | null = null;

export function setCustomEncoder(fn: ((s: string) => number) | null): void {
  encodeFn = fn;
}

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
