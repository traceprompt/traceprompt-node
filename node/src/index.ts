/**
 * index.ts  (public surface)
 * ---------------------------------
 * Re-exports the two calls your users
 * will actually import:
 *
 *   import { initTracePrompt, wrapLLM }
 *            from '@traceprompt/node'
 * ---------------------------------
 */

export { initTraceprompt, wrap } from "./wrapper";

// Re-export typings so downstream code can
// `import type { TracePromptInit } from ...`
export type { TracePromptInit, WrapOpts } from "./types";
