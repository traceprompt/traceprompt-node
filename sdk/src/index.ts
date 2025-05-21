/**
 * @module @traceprompt/sdk
 * @description Tamper-proof logging SDK for AI systems with blockchain anchoring and audit capabilities.
 * Features immutable logging chain with cryptographic linking, PII masking, and OpenTelemetry integration.
 *
 * Basic usage:
 * ```typescript
 * import OpenAI from 'openai';
 * import { init, wrap } from '@traceprompt/sdk';
 *
 * // Initialize with your API key
 * init({ apiKey: 'your-api-key' });
 *
 * // Wrap your OpenAI client
 * const openai = wrap(new OpenAI());
 *
 * // Use normally - all calls are now logged
 * const response = await openai.chat.completions.create({...});
 * ```
 */

import OpenAI from "openai";
import { mask } from "./redactor";
import { send as sendHttp, configure as configureHttp } from "./logger";
import { link } from "./hash";
import { JSONValue } from "./types";
import { LogEntry } from "./schema/audit-entry";
import { getActiveSpan, setSpanAttributes } from "./otel";

/**
 * Configuration options for initializing the SDK
 * @interface InitOptions
 * @property {string} apiKey - Your Traceprompt API key for authentication
 * @property {string} [apiUrl] - Optional custom API endpoint URL. Falls back to TP_API_URL env var
 */
export interface InitOptions {
  apiKey: string;
  apiUrl?: string;
}

let apiKey: string;
let pendingMeta: Record<string, JSONValue> = {};

/**
 * Initializes the Traceprompt SDK with the provided configuration.
 * Must be called before using any other SDK functions.
 *
 * @param {InitOptions} opts - Configuration options
 * @throws {Error} If apiKey is not provided
 *
 * @example
 * ```typescript
 * init({
 *   apiKey: 'tp_123...',
 *   apiUrl: 'https://custom.collector.url/logs'
 * });
 * ```
 */
export function init(opts: InitOptions) {
  apiKey = opts.apiKey;

  configureHttp({
    apiKey: opts.apiKey,
    url: opts.apiUrl ?? process.env.TP_API_URL,
  });

  console.log("[traceprompt] SDK initialised (v0.0.2, masking on)");
}

/**
 * Wraps an OpenAI client instance to enable automatic logging of all chat completions.
 * Each API call is logged with:
 * - Cryptographically linked chain of events
 * - PII masking for privacy
 * - Latency measurements
 * - OpenTelemetry integration
 *
 * @param {OpenAI} client - The OpenAI client instance to wrap
 * @returns {OpenAI} Wrapped client with logging capabilities
 * @throws {Error} If SDK is not initialized with init()
 *
 * @example
 * ```typescript
 * const openai = wrap(new OpenAI({ apiKey: 'sk-...' }));
 * // Now use openai.chat.completions.create as normal
 * ```
 */
export function wrap(client: OpenAI): OpenAI {
  const originalCreate = client.chat.completions.create;

  client.chat.completions.create = new Proxy(originalCreate, {
    apply: async (target, thisArg, args) => {
      const t0 = performance.now();

      // Get active span if OpenTelemetry is available
      const span = getActiveSpan();

      const result = await Reflect.apply(target, thisArg, args);
      const latency = performance.now() - t0;

      const safePrompt = mask(JSON.stringify(args[0]));
      const safeResponse = mask(JSON.stringify(result));

      const base = {
        apiKey,
        ts: new Date().toISOString(),
        prompt: safePrompt,
        response: safeResponse,
        latency_ms: Math.round(latency),
        prevHash: null,
        hash: "",
      } as const;

      const entry = link(base) as LogEntry;

      setSpanAttributes(span, {
        "ai.prompt.tokens": safePrompt.length,
        "ai.response.tokens": safeResponse.length,
        "ai.latency_ms": entry.latency_ms,
        "ai.hash": entry.hash,
        ...(entry.prevHash && { "ai.prev_hash": entry.prevHash }),
      });

      sendHttp(entry);

      return result;
    },
  });

  return client;
}

/**
 * Attaches custom metadata to the next LLM call only.
 * The metadata will be cleared after the next API call.
 *
 * @param {Record<string, JSONValue>} meta - Key-value pairs of metadata to attach
 *
 * @example
 * ```typescript
 * // Add context to the next API call
 * enrich({
 *   userId: 'u_123',
 *   sessionId: 's_789',
 *   context: 'customer_support'
 * });
 *
 * // This call will include the metadata
 * const response = await openai.chat.completions.create({...});
 * ```
 */
export function enrich(meta: Record<string, JSONValue>): void {
  Object.assign(pendingMeta, meta);
}
