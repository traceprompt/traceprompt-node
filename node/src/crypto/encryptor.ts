import { buildClient, CommitmentPolicy } from "@aws-crypto/client-node";

import { buildKeyring } from "../keyring";
import { EncryptedBundle } from "../types";

const { encrypt, decrypt } = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT
);

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

export async function decryptBundle(bundle: EncryptedBundle): Promise<Buffer> {
  const keyring = buildKeyring();

  const { plaintext } = await decrypt(
    keyring,
    Buffer.from(bundle.ciphertext, "base64")
  );
  return plaintext;
}
