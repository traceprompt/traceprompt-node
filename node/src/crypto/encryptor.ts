/**
 * crypto/encryptor.ts
 * --------------------
 * Envelope AES-256-GCM using AWS Encryption SDK v4.
 *  • encryptBuffer → EncryptedBundle
 *  • decryptBundle → Buffer         (for UI / tests only)
 */

import { buildClient, CommitmentPolicy } from "@aws-crypto/client-node";
import { buildKeyring } from "../keyring";
import { EncryptedBundle } from "../types";

/* One global client bound to the strictest policy */
const { encrypt, decrypt } = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT
);

/* ---------- Encrypt ---------- */
export async function encryptBuffer(plain: Buffer): Promise<EncryptedBundle> {
  const keyring = buildKeyring();

  /* encryptionContext optional; omit for size */
  const { result, messageHeader } = await encrypt(keyring, plain);

  return {
    ciphertext: Buffer.from(result).toString("base64"),
    encryptedDataKey: Buffer.from(
      messageHeader.encryptedDataKeys[0].encryptedDataKey
    ).toString("base64"),
    algoSuiteId: messageHeader.suiteId,
  };
}

/* ---------- Decrypt (client-side) ---------- */
export async function decryptBundle(bundle: EncryptedBundle): Promise<Buffer> {
  const keyring = buildKeyring();

  const { plaintext } = await decrypt(
    keyring,
    Buffer.from(bundle.ciphertext, "base64")
  );
  return plaintext;
}
