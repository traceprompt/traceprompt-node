/**
 * @module otel
 * @description OpenTelemetry integration module providing optional distributed tracing support.
 * Features:
 * - Lazy loading of OpenTelemetry API
 * - Safe fallbacks when OpenTelemetry is not available
 * - Span attribute management
 * - Active span access
 *
 * This module makes OpenTelemetry integration optional - the SDK works without
 * requiring OpenTelemetry as a mandatory dependency.
 */

import type { Span, AttributeValue } from "@opentelemetry/api";

/** OpenTelemetry API instance, undefined if not available */
let api: typeof import("@opentelemetry/api") | undefined;

// Lazy load OpenTelemetry API to avoid requiring it as a dependency
try {
  api = require("@opentelemetry/api");
} catch {
  api = undefined;
}

/**
 * Sets attributes on an OpenTelemetry span if available.
 * Safely handles cases where:
 * - OpenTelemetry is not installed
 * - Span is undefined
 * - Attribute values are null/undefined
 *
 * @param {Span | undefined} span - OpenTelemetry span to set attributes on
 * @param {Record<string, AttributeValue>} attrs - Key-value pairs of attributes
 *
 * @example
 * ```typescript
 * const span = getActiveSpan();
 * setSpanAttributes(span, {
 *   'ai.prompt.tokens': 150,
 *   'ai.response.tokens': 50,
 *   'ai.latency_ms': 1200
 * });
 * ```
 */
export function setSpanAttributes(
  span: Span | undefined,
  attrs: Record<string, AttributeValue>
): void {
  if (!span || !api) return;

  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) {
      span.setAttribute(key, value);
    }
  });
}

/**
 * Retrieves the currently active OpenTelemetry span if available.
 * Returns undefined if:
 * - OpenTelemetry is not installed
 * - No active span exists
 *
 * @returns {Span | undefined} The currently active span or undefined
 *
 * @example
 * ```typescript
 * const span = getActiveSpan();
 * if (span) {
 *   // OpenTelemetry is available and has an active span
 *   span.setAttribute('key', 'value');
 * }
 * ```
 */
export function getActiveSpan(): Span | undefined {
  if (!api) return undefined;
  return api.trace.getActiveSpan();
}
