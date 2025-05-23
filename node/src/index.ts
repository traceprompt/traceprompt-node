/**
 * Public API entry-point for the TracePrompt SDK
 * ---------------------------------------------
 * Typical consumer usage:
 *
 *   import { initTracePrompt, wrapLLM } from '@traceprompt/node'
 *
 *   initTracePrompt({
 *     tenantId: 'tnt_X',
 *     apiKey: 'tp_your_api_key',
 *     cmkArn: 'arn:…',
 *     ingestUrl: 'https://…'
 *   })
 *
 *   const safeChat = wrapLLM(openai.chat.completions.create, {
 *     modelVendor: 'openai',
 *     modelName: 'gpt-4o',
 *     userId: 'user-123'
 *   })
 *
 *   const answer = await safeChat('Hello world')
 */

export { initTracePrompt, wrapLLM } from "./wrapper";
export { decryptBundle } from "./crypto/encryptor";

export type { TracePromptInit, WrapOpts, EncryptedBundle } from "./types";
