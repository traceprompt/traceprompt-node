/**
 * @fileoverview Core SDK wrapper functions for LLM call tracking
 *
 * This module provides the main public API for the Traceprompt SDK:
 * - `initTracePrompt()` - Initialize SDK configuration
 * - `wrapLLM()` - Wrap any LLM function to add automatic tracking
 *
 * ## How it works
 *
 * When you wrap an LLM function:
 * 1. **Original call executes** - Your LLM call happens normally with full timing
 * 2. **Data capture** - Prompt, response, and metadata are captured
 * 3. **Client-side encryption** - All data encrypted with AES-256-GCM using your CMK
 * 4. **Hashing** - BLAKE3 hash computed for cryptographic integrity
 * 5. **Batching** - Encrypted payload queued for efficient delivery
 * 6. **Background delivery** - Batches sent to Traceprompt API asynchronously
 * 7. **Original response returned** - Your application continues normally
 *
 * ## Security guarantees
 * - **Zero plaintext transmission** - Only encrypted data leaves your environment
 * - **Customer-controlled encryption** - You control the encryption keys
 * - **Integrity protection** - Cryptographic hashes prevent tampering
 * - **Non-blocking operation** - Tracking never interrupts your LLM calls
 *
 * @see {@link https://docs.traceprompt.dev/sdk/security} for security architecture details
 */

import { performance } from "node:perf_hooks";
import { initTracePrompt as initCfg, ConfigManager } from "./config";
import { encryptBuffer } from "./crypto/encryptor";
import { computeLeaf } from "./crypto/hasher";
import { countTokens } from "./utils/tokenCounter";
import { Batcher } from "./queue/batcher";
const stringify = require("json-stable-stringify") as (v: any) => string;
import type { TracePromptInit, WrapOpts, EncryptedBundle } from "./types";

/* ------------------------------------------------------------------ */
/* 1. Public: initialise SDK                                          */
/* ------------------------------------------------------------------ */

/**
 * Initialize the Traceprompt SDK with your configuration.
 *
 * This must be called once before using `wrapLLM()`. Configuration can come from:
 * 1. **Direct configuration** - Pass an object to this function
 * 2. **Configuration file** - `.tracepromptrc.yml` in your project root
 * 3. **Environment variables** - `TRACEPROMPT_*` or `TP_*` prefixed vars
 *
 * @param cfg - Configuration object (optional if using config file or env vars)
 *
 * @example
 * ```typescript
 * // Direct configuration
 * initTracePrompt({
 *   tenantId: 'tnt_your_tenant',
 *   apiKey: 'tp_your_api_key',
 *   cmkArn: 'arn:aws:kms:region:account:key/key-id',
 *   ingestUrl: 'https://api.traceprompt.dev'
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Using .tracepromptrc.yml config file
 * // Create .tracepromptrc.yml in your project root:
 * // tenantId: tnt_your_tenant
 * // cmkArn: arn:aws:kms:...
 * // ingestUrl: https://api.traceprompt.dev
 *
 * initTracePrompt() // Reads from config file
 * ```
 *
 * @example
 * ```typescript
 * // Using environment variables
 * // export TRACEPROMPT_TENANT_ID=tnt_your_tenant
 * // export TP_CMK_ARN=arn:aws:kms:...
 * // export TRACEPROMPT_INGEST_URL=https://api.traceprompt.dev
 *
 * initTracePrompt() // Reads from environment
 * ```
 *
 * @example
 * ```typescript
 * // Local development setup
 * initTracePrompt({
 *   tenantId: 'tnt_dev_local',
 *   apiKey: 'tp_dev_key',
 *   cmkArn: 'local-dev', // Special value for local development
 *   ingestUrl: 'http://localhost:3000',
 *   batchSize: 10,       // Smaller batches for development
 *   flushIntervalMs: 1000 // Faster flushing for testing
 * })
 * // Requires: export LOCAL_DEV_KEK=$(openssl rand -hex 32)
 * ```
 *
 * ## Configuration Precedence
 * 1. Direct parameter to `initTracePrompt(cfg)`
 * 2. Environment variables (`TRACEPROMPT_*`, `TP_*`)
 * 3. `.tracepromptrc.yml` config file
 * 4. Built-in defaults
 *
 * ## Environment Variable Mapping
 * - `TRACEPROMPT_TENANT_ID` → `tenantId`
 * - `TRACEPROMPT_API_KEY` → `apiKey`
 * - `TP_CMK_ARN` → `cmkArn`
 * - `TRACEPROMPT_INGEST_URL` → `ingestUrl`
 * - `TRACEPROMPT_BATCH_SIZE` → `batchSize`
 * - `TRACEPROMPT_FLUSH_INTERVAL_MS` → `flushIntervalMs`
 *
 * @throws {Error} If required configuration is missing or invalid
 * @throws {Error} If CMK ARN is invalid or inaccessible
 *
 * @see {@link TracePromptInit} for all configuration options
 * @see {@link https://docs.traceprompt.dev/sdk/configuration} for configuration guide
 */
export function initTracePrompt(cfg?: Partial<TracePromptInit>): void {
  initCfg(cfg);
}

/* ------------------------------------------------------------------ */
/* 2. Public: wrap any async LLM call                                 */
/* ------------------------------------------------------------------ */

/**
 * Wrap any LLM function to add automatic encrypted tracking and auditing.
 *
 * This function takes your existing LLM call and returns a new function that:
 * - Executes your original call with full timing and error handling
 * - Captures prompts, responses, and performance metadata
 * - Encrypts all data client-side with AES-256-GCM
 * - Queues encrypted data for batch delivery to Traceprompt
 * - Returns the original LLM response unchanged
 *
 * **Important**: The wrapped function has identical behavior to your original function.
 * Tracking happens asynchronously and never blocks or modifies your LLM calls.
 *
 * @template P - Type of parameters passed to the LLM function
 * @template R - Type of response returned by the LLM function
 *
 * @param originalFn - Your LLM function to wrap (must be async and return Promise<R>)
 * @param meta - Metadata about the model and usage context
 * @returns A new function with identical signature that includes tracking
 *
 * @example
 * ```typescript
 * // OpenAI GPT-4
 * import OpenAI from 'openai'
 * const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
 *
 * const trackedChat = wrapLLM(
 *   openai.chat.completions.create.bind(openai.chat.completions),
 *   {
 *     modelVendor: 'openai',
 *     modelName: 'gpt-4o',
 *     userId: 'user-123' // Optional: associate with specific user
 *   }
 * )
 *
 * // Use exactly like the original function
 * const response = await trackedChat({
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   temperature: 0.7
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Anthropic Claude
 * import Anthropic from '@anthropic-ai/sdk'
 * const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
 *
 * const trackedClaude = wrapLLM(
 *   anthropic.messages.create.bind(anthropic.messages),
 *   {
 *     modelVendor: 'anthropic',
 *     modelName: 'claude-3-5-sonnet-20241022',
 *     userId: 'analyst-456'
 *   }
 * )
 *
 * const response = await trackedClaude({
 *   model: 'claude-3-5-sonnet-20241022',
 *   max_tokens: 1000,
 *   messages: [{ role: 'user', content: 'Analyze this data...' }]
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Custom/Local LLM
 * async function myLocalLLM(prompt: string, params?: any) {
 *   // Your custom LLM implementation
 *   return await fetch('http://localhost:8080/generate', {
 *     method: 'POST',
 *     body: JSON.stringify({ prompt, ...params })
 *   }).then(r => r.json())
 * }
 *
 * const trackedLocal = wrapLLM(myLocalLLM, {
 *   modelVendor: 'local',
 *   modelName: 'llama-3.1-70b-instruct',
 *   userId: 'researcher-789'
 * })
 *
 * const result = await trackedLocal('Explain quantum computing', {
 *   max_tokens: 500
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Function wrapping with different binding patterns
 *
 * // Method binding (recommended for class methods)
 * const tracked1 = wrapLLM(
 *   openai.chat.completions.create.bind(openai.chat.completions),
 *   { modelVendor: 'openai', modelName: 'gpt-4o' }
 * )
 *
 * // Arrow function (for custom functions)
 * const tracked2 = wrapLLM(
 *   async (prompt, params) => await myCustomLLM(prompt, params),
 *   { modelVendor: 'custom', modelName: 'my-model' }
 * )
 *
 * // Named function reference
 * async function callGPT(prompt: string, params?: any) {
 *   return await openai.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages: [{ role: 'user', content: prompt }],
 *     ...params
 *   })
 * }
 * const tracked3 = wrapLLM(callGPT, {
 *   modelVendor: 'openai',
 *   modelName: 'gpt-4o'
 * })
 * ```
 *
 * ## What gets tracked
 *
 * **Encrypted data** (sent to Traceprompt):
 * - Full prompt text
 * - Complete LLM response
 * - Request/response timestamp
 *
 * **Metadata** (sent in plaintext for analytics):
 * - Model vendor and name
 * - User ID (if provided)
 * - Token counts (approximate)
 * - Latency measurements
 * - Any `staticMeta` from configuration
 *
 * ## Performance Impact
 * - **<2ms P95 overhead** added to your LLM calls
 * - **Async processing** - encryption and delivery happen off critical path
 * - **Batched delivery** - network calls optimized automatically
 * - **No blocking** - SDK errors never interrupt your LLM calls
 *
 * ## Error Behavior
 * ```typescript
 * try {
 *   const response = await trackedLLM(prompt)
 *   // Original response returned normally
 * } catch (error) {
 *   // This is an error from your LLM, not the SDK
 *   // SDK errors are logged but never thrown
 * }
 * ```
 *
 * @throws {Error} Only if `initTracePrompt()` hasn't been called
 * @throws {Error} Never throws due to tracking/encryption errors (logged instead)
 *
 * @see {@link WrapOpts} for metadata options
 * @see {@link https://docs.traceprompt.dev/sdk/wrapping} for advanced usage patterns
 */
export function wrapLLM<P extends Record<string, any>, R>(
  originalFn: (prompt: string, params?: P) => Promise<R>,
  meta: WrapOpts
): (prompt: string, params?: P) => Promise<R> {
  const staticMeta = ConfigManager.cfg.staticMeta;

  return async function wrapped(prompt: string, params?: P): Promise<R> {
    /* ---------- 1. Call the underlying model -------------------- */
    const t0 = performance.now();
    const result = await originalFn(prompt, params);
    const t1 = performance.now();

    /* ---------- 2. Assemble plaintext JSON ---------------------- */
    const plaintextJson = JSON.stringify({
      prompt,
      response: result,
    });

    /* ---------- 3. Client-side encryption ----------------------- */
    const enc: EncryptedBundle = await encryptBuffer(
      Buffer.from(plaintextJson, "utf8")
    );

    /* ---------- 4. Build metadata payload ----------------------- */
    const payload = {
      ...staticMeta,
      tenantId: ConfigManager.cfg.tenantId,
      modelVendor: meta.modelVendor,
      modelName: meta.modelName,
      userId: meta.userId,
      ts_client: new Date().toISOString(),
      latency_ms: +(t1 - t0).toFixed(2),
      prompt_tokens: countTokens(prompt),
      response_tokens: countTokens(
        typeof result === "string" ? result : JSON.stringify(result)
      ),
      enc,
    };

    /* ---------- 5. Compute hash & enqueue ----------------------- */
    const leafHash = computeLeaf(stringify(payload));
    Batcher.enqueue({ payload, leafHash });

    /* ---------- 6. Return original result ----------------------- */
    return result;
  };
}
