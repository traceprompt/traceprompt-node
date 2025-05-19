/* ------------------------------------------------------------------
 * otel.ts  •  Attach Traceprompt attributes to the current span
 * ------------------------------------------------------------------
 *  ▸ addSpanAttrs(hash: string, latency: number)
 *      • If OpenTelemetry is present → sets span attributes.
 *      • If not, function is a no-op (keeps SDK dep-free).
 * ------------------------------------------------------------------ */

import type { Context, Span } from "@opentelemetry/api";

// We import lazily so OpenTelemetry stays an *optional* peer dependency.
let api: typeof import("@opentelemetry/api") | undefined;

try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  api = require("@opentelemetry/api");
} catch {
  /* OpenTelemetry not installed — fall through to no-op */
}

/**
 * Adds `traceprompt.hash` and `traceprompt.latency_ms` to the active OTel span.
 *
 * Safe to call regardless of whether the app has initialised OpenTelemetry.
 */
export function addSpanAttrs(hash: string, latency: number): void {
  if (!api) return; // no OTel libs

  const span: Span | undefined = api.trace.getSpan(
    api.context.active() as Context
  );
  if (!span) return; // no active span

  span.setAttribute("traceprompt.hash", hash);
  span.setAttribute("traceprompt.latency_ms", latency);
}
