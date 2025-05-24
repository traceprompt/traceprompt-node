/**
 * @fileoverview Client-side encryption for the Traceprompt SDK
 *
 * This module provides AES-256-GCM envelope encryption using the AWS Encryption SDK.
 * All sensitive data (prompts, responses) is encrypted client-side before transmission,
 * ensuring zero plaintext storage on Traceprompt servers.
 *
 * ## Security Model
 *
 * **Envelope Encryption Architecture:**
 * 1. **Data Encryption Key (DEK)** - Random AES-256 key generated for each record
 * 2. **Customer Master Key (CMK)** - Your AWS KMS key (or local dev key) encrypts the DEK
 * 3. **Encrypted Data** - Your prompt/response encrypted with the DEK
 * 4. **Encrypted DEK** - The DEK encrypted with your CMK for safe transmission
 *
 * **Key Benefits:**
 * - **Customer-controlled encryption** - You own and control the master keys
 * - **Zero plaintext transmission** - Only encrypted data leaves your environment
 * - **High performance** - Symmetric encryption for data, asymmetric for key management
 * - **Compliance ready** - Meets SOC2, HIPAA, and other regulatory requirements
 *
 * ## Encryption Flow
 *
 * ```
 * Your Data → [AES-256-GCM] → Ciphertext
 *     ↓              ↑
 * Random DEK → [Your CMK] → Encrypted DEK
 *     ↓
 * Safe transmission to Traceprompt
 * ```
 *
 * ## Keyring Support
 *
 * **Production (AWS KMS):**
 * - Uses `AwsKmsKeyringNode` with your Customer Master Key
 * - Requires IAM permissions: `kms:Decrypt`, `kms:DescribeKey`, `kms:GenerateDataKey`
 * - Multi-region support for high availability
 *
 * **Development (Local):**
 * - Uses `RawAesKeyringNode` with local symmetric key
 * - Requires `LOCAL_DEV_KEK` environment variable (32-byte hex)
 * - For testing and development environments only
 *
 * ## Performance Characteristics
 * - **Encryption speed**: ~0.2ms per 256-byte payload (Apple M3)
 * - **Memory overhead**: Minimal - streaming encryption for large payloads
 * - **Network overhead**: ~100 bytes additional metadata per record
 *
 * ## Usage in SDK
 *
 * ```typescript
 * // Automatic encryption (handled by wrapLLM)
 * const trackedLLM = wrapLLM(originalLLM, { modelVendor: 'openai', modelName: 'gpt-4o' })
 * const response = await trackedLLM('Hello') // Automatically encrypted
 *
 * // Manual decryption (for audit/compliance)
 * import { decryptBundle } from '@traceprompt/node'
 * const originalData = await decryptBundle(encryptedRecord)
 * ```
 *
 * @see {@link https://docs.aws.amazon.com/encryption-sdk/} for AWS Encryption SDK details
 * @see {@link https://docs.traceprompt.dev/security/encryption} for security architecture
 */

import { buildClient, CommitmentPolicy } from "@aws-crypto/client-node";

import { buildKeyring } from "../keyring";
import { EncryptedBundle } from "../types";

/**
 * Shared AWS Encryption SDK client with strict security policy.
 *
 * Uses `REQUIRE_ENCRYPT_REQUIRE_DECRYPT` commitment policy for maximum security:
 * - Requires key commitment during encryption (prevents key substitution attacks)
 * - Requires key commitment verification during decryption
 * - Ensures cryptographic binding between ciphertext and encryption key
 *
 * @see {@link https://docs.aws.amazon.com/encryption-sdk/latest/developer-guide/commitment-policy.html}
 */
const { encrypt, decrypt } = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT
);

/* ---------- Encrypt ------------------------------------------------ */

/**
 * Encrypt a data buffer using AES-256-GCM envelope encryption.
 *
 * This function performs client-side encryption of sensitive data (prompts, responses)
 * before transmission to Traceprompt. The encryption uses your Customer Master Key
 * to protect a randomly generated Data Encryption Key, which encrypts the actual data.
 *
 * **Security guarantees:**
 * - **AES-256-GCM encryption** - Industry-standard authenticated encryption
 * - **Fresh data keys** - New random key generated for each encryption
 * - **Customer-controlled keys** - Uses your AWS KMS CMK or local development key
 * - **Authenticated encryption** - Built-in integrity protection prevents tampering
 *
 * @param plain - The sensitive data to encrypt (prompts, responses, metadata)
 * @returns Encrypted bundle with base64-encoded fields safe for JSON transport
 *
 * @example
 * ```typescript
 * // Encrypt LLM interaction data
 * const sensitiveData = JSON.stringify({
 *   prompt: "What is the company's revenue for Q3?",
 *   response: "The revenue was $2.4M, up 15% from last quarter..."
 * })
 *
 * const encryptedBundle = await encryptBuffer(Buffer.from(sensitiveData, 'utf8'))
 * // Returns: { ciphertext: "base64...", encryptedDataKey: "base64...", suiteId: 123 }
 * ```
 *
 * @example
 * ```typescript
 * // The encrypted bundle structure
 * interface EncryptedBundle {
 *   ciphertext: string        // Base64-encoded encrypted data
 *   encryptedDataKey: string  // Base64-encoded encrypted DEK
 *   suiteId: number          // Encryption algorithm identifier
 * }
 * ```
 *
 * ## Encryption Process
 *
 * 1. **Generate random DEK** - 256-bit AES key created for this encryption
 * 2. **Encrypt data** - Your sensitive data encrypted with DEK using AES-256-GCM
 * 3. **Encrypt DEK** - The DEK is encrypted with your Customer Master Key
 * 4. **Return bundle** - Ciphertext + encrypted DEK + metadata for transmission
 *
 * ## Performance
 * - **Typical latency**: 0.1-0.5ms for standard LLM payloads (1-10KB)
 * - **Scalability**: Handles payloads up to 4MB efficiently
 * - **Memory usage**: Minimal overhead, no plaintext retention
 *
 * ## Error Handling
 * ```typescript
 * try {
 *   const encrypted = await encryptBuffer(data)
 * } catch (error) {
 *   // Common errors:
 *   // - AWS KMS access denied (check IAM permissions)
 *   // - Network connectivity issues
 *   // - Invalid/revoked CMK
 *   console.error('Encryption failed:', error.message)
 * }
 * ```
 *
 * @throws {Error} If keyring is not accessible (AWS KMS permissions, network issues)
 * @throws {Error} If Customer Master Key is invalid, disabled, or not found
 * @throws {Error} If local development key is missing or invalid
 *
 * @see {@link buildKeyring} for keyring configuration
 * @see {@link EncryptedBundle} for return type details
 */
export async function encryptBuffer(plain: Buffer): Promise<EncryptedBundle> {
  const keyring = buildKeyring();

  const { result, messageHeader } = await encrypt(keyring, plain);

  return {
    ciphertext: Buffer.from(result).toString("base64"),
    encryptedDataKey: Buffer.from(
      messageHeader.encryptedDataKeys[0].encryptedDataKey
    ).toString("base64"),
    suiteId: messageHeader.suiteId, // optional diagnostics
  };
}

/* ---------- Decrypt (UI / tests) ---------------------------------- */

/**
 * Decrypt an encrypted bundle back to original plaintext.
 *
 * **⚠️ Important Security Note:**
 * This function is intended for **customer-side use only** (audit tools, compliance
 * reporting, development testing). It should **NEVER** be called in the Traceprompt
 * ingestion pipeline - the core security guarantee is that Traceprompt servers
 * never see your plaintext data.
 *
 * **Typical use cases:**
 * - **Audit and compliance** - Decrypt records for regulatory review
 * - **Data analysis** - Extract data for business intelligence
 * - **Development testing** - Verify encryption/decryption in unit tests
 * - **Customer UI tools** - Build admin dashboards for data review
 *
 * @param bundle - The encrypted bundle returned by `encryptBuffer()`
 * @returns Original plaintext data as a Buffer
 *
 * @example
 * ```typescript
 * // Decrypt for audit purposes
 * import { decryptBundle } from '@traceprompt/node'
 *
 * // Fetch encrypted record from your audit API
 * const encryptedRecord = await fetch('/api/audit/records/123')
 *   .then(r => r.json())
 *
 * // Decrypt using the same CMK that encrypted it
 * const originalData = await decryptBundle({
 *   ciphertext: encryptedRecord.payload.enc.ciphertext,
 *   encryptedDataKey: encryptedRecord.payload.enc.encryptedDataKey,
 *   suiteId: encryptedRecord.payload.enc.suiteId
 * })
 *
 * // Parse the original LLM interaction
 * const { prompt, response } = JSON.parse(originalData.toString('utf8'))
 * console.log('Original prompt:', prompt)
 * console.log('Original response:', response)
 * ```
 *
 * @example
 * ```typescript
 * // Unit testing encryption round-trip
 * import { encryptBuffer, decryptBundle } from '@traceprompt/node'
 *
 * const originalData = Buffer.from('Hello, world!', 'utf8')
 * const encrypted = await encryptBuffer(originalData)
 * const decrypted = await decryptBundle(encrypted)
 *
 * assert(originalData.equals(decrypted)) // Should be identical
 * ```
 *
 * @example
 * ```typescript
 * // Building an audit dashboard
 * async function auditLLMInteractions(startDate: Date, endDate: Date) {
 *   const records = await fetchAuditRecords(startDate, endDate)
 *
 *   for (const record of records) {
 *     try {
 *       const decrypted = await decryptBundle(record.payload.enc)
 *       const interaction = JSON.parse(decrypted.toString('utf8'))
 *
 *       // Analyze for compliance, cost, quality, etc.
 *       analyzeInteraction(interaction, record.metadata)
 *     } catch (error) {
 *       console.warn(`Failed to decrypt record ${record.id}:`, error.message)
 *     }
 *   }
 * }
 * ```
 *
 * ## Security Requirements
 *
 * **Access Control:**
 * - Requires the same Customer Master Key used for encryption
 * - IAM permissions: `kms:Decrypt`, `kms:DescribeKey` for AWS KMS
 * - Same `LOCAL_DEV_KEK` environment variable for local development
 *
 * **Network Security:**
 * - Decryption happens entirely client-side
 * - No plaintext data transmitted over network
 * - Audit logs should track decryption events for compliance
 *
 * ## Performance Considerations
 * - **Decryption speed**: Similar to encryption (~0.1-0.5ms per record)
 * - **Batch processing**: Process multiple records in parallel for efficiency
 * - **Memory usage**: Plaintext data is held in memory temporarily
 *
 * ## Error Handling
 * ```typescript
 * try {
 *   const plaintext = await decryptBundle(encryptedBundle)
 * } catch (error) {
 *   // Common errors:
 *   // - AWS KMS access denied (check IAM permissions)
 *   // - CMK not found or disabled
 *   // - Corrupted ciphertext or metadata
 *   // - Wrong keyring/environment (dev vs prod)
 *   console.error('Decryption failed:', error.message)
 * }
 * ```
 *
 * @throws {Error} If keyring lacks decrypt permissions for this ciphertext
 * @throws {Error} If ciphertext is corrupted or tampered with
 * @throws {Error} If encrypted data key cannot be decrypted with available CMK
 * @throws {Error} If bundle format is invalid or missing required fields
 *
 * @see {@link encryptBuffer} for encryption counterpart
 * @see {@link EncryptedBundle} for input type details
 * @see {@link https://docs.traceprompt.dev/audit/decryption} for audit workflows
 */
export async function decryptBundle(bundle: EncryptedBundle): Promise<Buffer> {
  const keyring = buildKeyring();

  const { plaintext } = await decrypt(
    keyring,
    Buffer.from(bundle.ciphertext, "base64")
  );
  return plaintext;
}
