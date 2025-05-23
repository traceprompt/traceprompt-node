/**
 * crypto/encryptor.ts
 * ------------------------------------------------------
 * Wrapper around AWS Encryption SDK v4 for envelope
 * encryption.  Keeps the public API minimal:
 *
 *   • encryptBuffer(plain)  → EncryptedBundle
 *   • decryptBundle(bundle) → Buffer
 *
 * decryptBundle is exported for customer-side UI or unit
 * tests—**never** call it inside the ingest path.
 * ------------------------------------------------------
 */

import { buildClient, CommitmentPolicy } from "@aws-crypto/client-node";

import { buildKeyring } from "../keyring";
import { EncryptedBundle } from "../types";

/* One shared client instance bound to strict policy. */
const { encrypt, decrypt } = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT
);

/* ---------- Encrypt ------------------------------------------------ */

/**
 * Encrypt a Buffer with a fresh data-key wrapped by the
 * customer’s CMK (or local-dev raw keyring).
 *
 * @returns   base64 fields safe for JSON transport.
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
 * Decrypt an EncryptedBundle back to plaintext.
 * Requires keyring with decrypt privilege (customer side).
 */
export async function decryptBundle(bundle: EncryptedBundle): Promise<Buffer> {
  const keyring = buildKeyring();

  const { plaintext } = await decrypt(
    keyring,
    Buffer.from(bundle.ciphertext, "base64")
  );
  return plaintext;
}
