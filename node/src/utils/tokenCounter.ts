let encodeFn: ((s: string) => number) | null = null;

import { Histogram } from "prom-client";
import { registry } from "../metrics";

const tokenCountHist = new Histogram({
  name: "traceprompt_tokens_per_string",
  help: "Number of tokens counted per string passed to countTokens()",
  buckets: [1, 5, 10, 20, 50, 100, 200, 500, 1000],
  registers: [registry],
});

export function setCustomEncoder(fn: ((s: string) => number) | null): void {
  encodeFn = fn;
}

export function countTokens(text: string): number {
  if (encodeFn) {
    const t = encodeFn(text);
    tokenCountHist.observe(t);
    return t;
  }

  if (maybeInitTiktoken()) {
    const t = encodeFn!(text);
    tokenCountHist.observe(t);
    return t;
  }

  const words = text.trim().split(/\s+/g).length;
  const tokens = Math.ceil(words * 1.33);
  tokenCountHist.observe(tokens);
  return tokens;
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
    return false;
  }
}
