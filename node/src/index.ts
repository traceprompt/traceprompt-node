/**
 * @fileoverview Traceprompt Node.js SDK
 *
 * A security-first SDK for tracking and auditing LLM interactions with
 * client-side encryption, cryptographic integrity, and immutable audit trails.
 *
 * ## Key Security Features
 * - **Client-side encryption**: All data encrypted with AES-256-GCM before leaving your environment
 * - **Customer-controlled keys**: Use your own AWS KMS keys or local encryption keys
 * - **Zero plaintext storage**: Traceprompt servers never see your actual prompts/responses
 * - **Cryptographic integrity**: BLAKE3 hashing and Merkle tree anchoring to Bitcoin
 * - **Immutable audit trails**: Hash-chained ledger with hourly blockchain anchoring
 *
 * ## Quick Start
 *
 * ```typescript
 * import { initTracePrompt, wrapLLM } from '@traceprompt/node'
 * import OpenAI from 'openai'
 *
 * // Initialize with your configuration
 * initTracePrompt({
 *   tenantId: 'tnt_your_tenant_id',
 *   apiKey: 'tp_your_api_key_here',
 *   cmkArn: 'arn:aws:kms:us-east-1:123456789:key/your-key-id',
 *   ingestUrl: 'https://api.traceprompt.dev'
 * })
 *
 * // Wrap your LLM calls
 * const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
 * const trackedChat = wrapLLM(openai.chat.completions.create.bind(openai.chat.completions), {
 *   modelVendor: 'openai',
 *   modelName: 'gpt-4o',
 *   userId: 'user-123'
 * })
 *
 * // Use normally - tracking happens automatically
 * const response = await trackedChat({
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: 'Hello, world!' }]
 * })
 * ```
 *
 * ## Configuration Options
 *
 * ### Production Setup (AWS KMS)
 * ```typescript
 * initTracePrompt({
 *   tenantId: 'tnt_abc123',           // Your tenant identifier
 *   apiKey: 'tp_live_xyz789',        // Your Traceprompt API key
 *   cmkArn: 'arn:aws:kms:...',       // Your AWS KMS Customer Master Key
 *   ingestUrl: 'https://api.traceprompt.dev',
 *   batchSize: 25,                   // Records per batch (default: 25)
 *   flushIntervalMs: 2000,           // Max time before flush (default: 2000ms)
 *   staticMeta: {                    // Additional metadata for all records
 *     environment: 'production',
 *     version: '1.0.0'
 *   }
 * })
 * ```
 *
 * ### Local Development Setup
 * ```typescript
 * // For local development without AWS KMS
 * initTracePrompt({
 *   tenantId: 'tnt_dev_local',
 *   apiKey: 'tp_dev_123',
 *   cmkArn: 'local-dev',             // Special value for local development
 *   ingestUrl: 'http://localhost:3000',
 *   // Requires LOCAL_DEV_KEK environment variable:
 *   // export LOCAL_DEV_KEK=$(openssl rand -hex 32)
 * })
 * ```
 *
 * ## Supported LLM Providers
 *
 * ```typescript
 * // OpenAI
 * const openaiChat = wrapLLM(openai.chat.completions.create.bind(openai.chat.completions), {
 *   modelVendor: 'openai',
 *   modelName: 'gpt-4o'
 * })
 *
 * // Anthropic Claude
 * const claudeChat = wrapLLM(anthropic.messages.create.bind(anthropic.messages), {
 *   modelVendor: 'anthropic',
 *   modelName: 'claude-3-5-sonnet-20241022'
 * })
 *
 * // Custom/Local models
 * const localChat = wrapLLM(myLocalLLM, {
 *   modelVendor: 'local',
 *   modelName: 'llama-3.1-70b'
 * })
 * ```
 *
 * ## Error Handling
 *
 * ```typescript
 * try {
 *   const response = await trackedChat(prompt)
 *   // Your original LLM response - tracking happens in background
 * } catch (error) {
 *   // Handle LLM errors normally - SDK errors are logged but don't interrupt
 *   console.error('LLM call failed:', error)
 * }
 * ```
 *
 * ## Decryption (for audit/compliance)
 *
 * ```typescript
 * import { decryptBundle } from '@traceprompt/node'
 *
 * // Decrypt a record for audit (requires same CMK access)
 * const originalData = await decryptBundle({
 *   ciphertext: record.payload.enc.ciphertext,
 *   encryptedDataKey: record.payload.enc.encryptedDataKey,
 *   iv: record.payload.enc.iv,
 *   authTag: record.payload.enc.authTag
 * })
 * ```
 *
 * ## Performance
 * - **Minimal overhead**: <2ms P95 latency added to LLM calls
 * - **Batched delivery**: Automatic batching reduces network overhead
 * - **Async processing**: Encryption and delivery happen off the critical path
 *
 * @see https://docs.traceprompt.dev for complete documentation
 * @see https://github.com/traceprompt/sdk for examples and source code
 */

export { initTracePrompt, wrapLLM } from "./wrapper";
export { decryptBundle } from "./crypto/encryptor";

export type { TracePromptInit, WrapOpts, EncryptedBundle } from "./types";
