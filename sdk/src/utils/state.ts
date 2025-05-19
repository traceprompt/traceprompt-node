/* ------------------------------------------------------------------
 * state.ts  •  Global settings & runtime state for @traceprompt/sdk
 * ------------------------------------------------------------------ */

import type { InitOptions, RuntimeState } from "./types";

/* ---------- 1. Default configuration -------------------------------- */

const defaults: Required<Omit<InitOptions, "apiKey">> = {
  piiRedact: "regex",
  batchSize: 100,
  flushIntervalMs: 50,
  hashAlgo: "blake3",
  walPath: "/tmp/traceprompt.wal",
  anchorInterval: "1h",
  tls: { mtls: false },
};

/**
 * Populated once via Traceprompt.init().
 * Exported as a live (frozen) object so other modules can read
 * without worrying about mutation races.
 */
export let settings: Readonly<Required<InitOptions>>;

/* ---------- 2. Runtime mutable state -------------------------------- */

export const state: RuntimeState = {
  // filled after init()
  config: undefined as unknown as Required<InitOptions>,

  // ring buffer allocated lazily in buffer.ts
  buffer: [],
  head: 0,
  tail: 0,
  chainHead: null,
};

/* ---------- 3. initSettings() helper -------------------------------- */

/** Called exactly once inside Traceprompt.init() */
export function initSettings(userOpts: InitOptions) {
  if (settings) throw new Error("Traceprompt already initialised");

  // merge defaults → user opts
  // (apiKey is mandatory so we assert here)
  const merged = {
    ...defaults,
    ...userOpts,
    apiKey: userOpts.apiKey,
  } as Required<InitOptions>;

  settings = Object.freeze(merged);
  state.config = settings; // keep a pointer inside runtime
  state.buffer = new Array(settings.batchSize);

  // Optionally pre-create WAL dir
  if (settings.walPath && typeof settings.walPath === "string") {
    const dir = require("node:path").dirname(settings.walPath);
    require("node:fs").mkdirSync(dir, { recursive: true });
  }
}
