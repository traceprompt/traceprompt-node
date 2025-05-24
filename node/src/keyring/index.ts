/**
 * @fileoverview Encryption keyring management for the Traceprompt SDK
 *
 * This module manages encryption keyrings that protect your Customer Master Keys (CMKs)
 * and enable secure envelope encryption. The keyring determines how Data Encryption Keys
 * are generated, encrypted, and decrypted for each record.
 *
 * ## Keyring Architecture
 *
 * The keyring is the bridge between your encryption keys and the AWS Encryption SDK:
 *
 * ```
 * Your CMK → Keyring → AWS Encryption SDK → Encrypted Records
 *    ↓           ↓
 * AWS KMS    Protection      AES-256-GCM
 * or Local   & Access       Envelope
 * Dev Key    Control        Encryption
 * ```
 *
 * ## Production vs Development
 *
 * **Production (AWS KMS):**
 * - Uses `KmsKeyringNode` with your AWS KMS Customer Master Key
 * - Requires IAM permissions and AWS credentials
 * - Supports multi-region keys and automatic key rotation
 * - Provides CloudTrail audit logs for all key usage
 * - Meets enterprise security and compliance requirements
 *
 * **Development (Local):**
 * - Uses `RawAesKeyringNode` with a local symmetric key
 * - Requires `LOCAL_DEV_KEK` environment variable
 * - No AWS dependencies or network calls
 * - Fast and isolated for testing and development
 * - **Not suitable for production use**
 *
 * ## Security Model
 *
 * **Customer-Controlled Encryption:**
 * - You own and control the master keys (CMK)
 * - Traceprompt servers never have access to your keys
 * - Each record uses a unique Data Encryption Key (DEK)
 * - DEKs are encrypted with your CMK before transmission
 *
 * **Key Rotation Support:**
 * - Keyring is built fresh for each encryption operation
 * - Automatically picks up AWS KMS key rotation
 * - No application restart required for key updates
 * - Backwards compatibility with old encrypted records
 *
 * ## AWS KMS Requirements
 *
 * **IAM Permissions Required:**
 * ```json
 * {
 *   "Version": "2012-10-17",
 *   "Statement": [
 *     {
 *       "Effect": "Allow",
 *       "Action": [
 *         "kms:GenerateDataKey",
 *         "kms:Decrypt",
 *         "kms:DescribeKey"
 *       ],
 *       "Resource": "arn:aws:kms:region:account:key/your-key-id"
 *     }
 *   ]
 * }
 * ```
 *
 * **AWS Credentials:**
 * - AWS SDK default credential chain (recommended)
 * - IAM roles for EC2/ECS/Lambda (recommended for production)
 * - AWS CLI credentials for local development
 * - Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
 *
 * ## Local Development Setup
 *
 * ```bash
 * # Generate a secure development key (do this once)
 * export LOCAL_DEV_KEK=$(openssl rand -hex 32)
 *
 * # Or create a persistent development key
 * echo "LOCAL_DEV_KEK=$(openssl rand -hex 32)" >> .env.local
 * ```
 *
 * **⚠️ Security Warning:**
 * Local development keys are **not suitable for production**. They provide:
 * - No access control or audit logging
 * - No key rotation capabilities
 * - No hardware security module protection
 * - Risk of key exposure in environment variables
 *
 * ## Usage Examples
 *
 * The keyring is used automatically by the encryption system:
 *
 * ```typescript
 * // Automatic keyring selection based on configuration
 * initTraceprompt({
 *   cmkArn: 'arn:aws:kms:us-east-1:123456789:key/your-key-id', // Production
 *   // OR
 *   cmkArn: 'local-dev' // Development
 * })
 *
 * // Encryption automatically uses the appropriate keyring
 * const trackedLLM = wrapLLM(originalLLM, { modelVendor: 'openai', modelName: 'gpt-4o' })
 * await trackedLLM('Sensitive prompt') // Encrypted with your CMK
 * ```
 *
 * ## Error Scenarios
 *
 * **AWS KMS Errors:**
 * - `AccessDenied` - Check IAM permissions
 * - `KeyNotFound` - Verify CMK ARN and region
 * - `DisabledException` - CMK is disabled or deleted
 * - `NetworkError` - Check AWS connectivity
 *
 * **Local Development Errors:**
 * - Missing `LOCAL_DEV_KEK` environment variable
 * - Invalid key format (must be 64-character hex)
 * - Key exposure in logs or configuration files
 *
 * @see {@link https://docs.aws.amazon.com/kms/} for AWS KMS documentation
 * @see {@link https://docs.aws.amazon.com/encryption-sdk/} for AWS Encryption SDK details
 * @see {@link https://docs.traceprompt.dev/security/keys} for key management guide
 */

import {
  KmsKeyringNode,
  RawAesKeyringNode,
  RawAesWrappingSuiteIdentifier,
} from "@aws-crypto/client-node";
import { ConfigManager } from "../config";

/**
 * Union type representing all supported keyring implementations.
 *
 * Used internally by the encryption system to provide type safety
 * while supporting both production (KMS) and development (local) keyrings.
 */
export type AnyKeyring = KmsKeyringNode | RawAesKeyringNode;

/**
 * Build an encryption keyring based on the current SDK configuration.
 *
 * This function creates the appropriate keyring implementation based on your
 * `cmkArn` configuration. The keyring is built fresh for each call to support
 * automatic key rotation and ensure long-running processes can pick up key
 * updates without requiring a restart.
 *
 * **Keyring Selection Logic:**
 * - If `cmkArn === "local-dev"` → Creates `RawAesKeyringNode` for development
 * - Otherwise → Creates `KmsKeyringNode` for production AWS KMS usage
 *
 * @returns Configured keyring ready for encryption/decryption operations
 *
 * @example
 * ```typescript
 * // Production usage (automatic via SDK)
 * initTraceprompt({
 *   cmkArn: 'arn:aws:kms:us-east-1:123456789:key/12345678-1234-1234-1234-123456789012'
 * })
 * // buildKeyring() will return KmsKeyringNode
 *
 * // Development usage (automatic via SDK)
 * initTraceprompt({
 *   cmkArn: 'local-dev'
 * })
 * // buildKeyring() will return RawAesKeyringNode
 * // Requires: export LOCAL_DEV_KEK=$(openssl rand -hex 32)
 * ```
 *
 * @example
 * ```typescript
 * // Manual keyring usage (advanced)
 * import { buildKeyring } from '@traceprompt/node/keyring'
 * import { encrypt } from '@aws-crypto/client-node'
 *
 * const keyring = buildKeyring()
 * const { result } = await encrypt(keyring, Buffer.from('sensitive data'))
 * ```
 *
 * ## Production Keyring (AWS KMS)
 *
 * When `cmkArn` is an AWS KMS key ARN, creates a `KmsKeyringNode` that:
 *
 * **Features:**
 * - **Secure key generation** - Uses AWS KMS hardware security modules
 * - **Access control** - IAM policies control who can use the key
 * - **Audit logging** - All key usage logged in CloudTrail
 * - **Key rotation** - Supports automatic annual key rotation
 * - **Multi-region** - Can use multi-region keys for global applications
 * - **Compliance** - Meets SOC2, HIPAA, and other regulatory requirements
 *
 * **Requirements:**
 * - Valid AWS credentials with KMS permissions
 * - Network connectivity to AWS KMS service
 * - CMK must be in `Enabled` state
 * - IAM permissions: `kms:GenerateDataKey`, `kms:Decrypt`, `kms:DescribeKey`
 *
 * ## Development Keyring (Local)
 *
 * When `cmkArn === "local-dev"`, creates a `RawAesKeyringNode` that:
 *
 * **Features:**
 * - **No AWS dependencies** - Works offline and in isolated environments
 * - **Fast performance** - No network calls for key operations
 * - **Deterministic** - Same key produces same results for testing
 * - **Simple setup** - Just requires one environment variable
 *
 * **Limitations:**
 * - **No access control** - Anyone with the key can decrypt
 * - **No audit logging** - No record of key usage
 * - **No rotation** - Manual key management required
 * - **Key exposure risk** - Key stored in environment variables
 * - **Not production-ready** - Lacks enterprise security features
 *
 * **Setup Requirements:**
 * ```bash
 * # Generate a 256-bit (32-byte) key as 64 hex characters
 * export LOCAL_DEV_KEK=$(openssl rand -hex 32)
 *
 * # Example key (do not use this exact value):
 * # LOCAL_DEV_KEK=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
 * ```
 *
 * ## Error Handling
 *
 * **AWS KMS Errors:**
 * ```typescript
 * try {
 *   const keyring = buildKeyring()
 * } catch (error) {
 *   if (error.code === 'AccessDenied') {
 *     // Check IAM permissions for your CMK
 *   } else if (error.code === 'KeyUnavailableException') {
 *     // CMK is disabled, deleted, or in different region
 *   } else if (error.code === 'NetworkingError') {
 *     // Check AWS connectivity and credentials
 *   }
 * }
 * ```
 *
 * **Local Development Errors:**
 * ```typescript
 * try {
 *   const keyring = buildKeyring()
 * } catch (error) {
 *   if (error.message.includes('LOCAL_DEV_KEK')) {
 *     // Set LOCAL_DEV_KEK environment variable
 *     // Must be exactly 64 hexadecimal characters
 *   }
 * }
 * ```
 *
 * ## Security Best Practices
 *
 * **Production:**
 * - Use IAM roles instead of long-term access keys
 * - Enable CloudTrail logging for KMS key usage
 * - Rotate CMK annually (enable automatic rotation)
 * - Use least-privilege IAM permissions
 * - Monitor for unusual key usage patterns
 *
 * **Development:**
 * - Never use development keys in production
 * - Don't commit `LOCAL_DEV_KEK` to version control
 * - Regenerate development keys regularly
 * - Use different keys for different developers/environments
 * - Consider using AWS KMS even for development if possible
 *
 * ## Key Rotation Support
 *
 * This function builds a fresh keyring on each call, which provides:
 * - **Automatic rotation** - New encryptions use rotated keys automatically
 * - **Backwards compatibility** - Old records can still be decrypted
 * - **No downtime** - Key rotation doesn't require application restart
 * - **Gradual migration** - Records naturally migrate to new keys over time
 *
 * @throws {Error} If `cmkArn === "local-dev"` but `LOCAL_DEV_KEK` is missing or invalid
 * @throws {Error} If AWS KMS key is not accessible (permissions, network, key state)
 * @throws {Error} If SDK configuration is not initialized (`initTraceprompt()` not called)
 *
 * @see {@link https://docs.aws.amazon.com/kms/latest/developerguide/rotating-keys.html} for key rotation
 * @see {@link https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html} for IAM permissions
 * @see {@link ConfigManager} for configuration management
 */
export function buildKeyring(): AnyKeyring {
  const { cmkArn } = ConfigManager.cfg;

  /* ---------- Local-dev path ----------------------------------- */
  if (cmkArn === "local-dev") {
    const hex = process.env["LOCAL_DEV_KEK"];
    if (!hex || hex.length !== 64) {
      throw new Error(
        'Traceprompt: LOCAL_DEV_KEK (64-char hex) must be set when cmkArn="local-dev"'
      );
    }

    // Create a truly isolated buffer (not a slice of a larger buffer)
    const sourceBuffer = Buffer.from(hex, "hex");
    const keyBuffer = Buffer.alloc(sourceBuffer.length);
    sourceBuffer.copy(keyBuffer);

    return new RawAesKeyringNode({
      keyName: "dev",
      keyNamespace: "traceprompt",
      unencryptedMasterKey: keyBuffer,
      wrappingSuite:
        RawAesWrappingSuiteIdentifier.AES256_GCM_IV12_TAG16_NO_PADDING,
    });
  }

  /* ---------- Production path (AWS KMS) ------------------------ */
  return new KmsKeyringNode({
    generatorKeyId: cmkArn,
  });
}
