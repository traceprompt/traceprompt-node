import { buildClient, CommitmentPolicy } from "@aws-crypto/client-node";

import { buildKeyring } from "../keyring";
import { EncryptedBundle } from "../types";
import { encryptHist } from "../metrics";
import { ConfigManager } from "../config";
import { log } from "../utils/logger";

const { encrypt, decrypt } = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT
);

export async function encryptBuffer(plain: Buffer): Promise<EncryptedBundle> {
  const keyring = buildKeyring();
  const endTimer = encryptHist.startTimer();
  try {
    log.info("Encrypting buffer", {
      orgId: ConfigManager.cfg.orgId,
    });

    const { result, messageHeader } = await encrypt(keyring, plain, {
      encryptionContext: {
        org_id: ConfigManager.cfg.orgId,
      },
    });

    const bundle = {
      ciphertext: Buffer.from(result).toString("base64"),
      encryptedDataKey: Buffer.from(
        messageHeader.encryptedDataKeys[0].encryptedDataKey
      ).toString("base64"),
      suiteId: messageHeader.suiteId,
    };

    return bundle;
  } finally {
    endTimer();
  }
}

export async function decryptBundle(bundle: EncryptedBundle): Promise<Buffer> {
  const keyring = buildKeyring();

  const { plaintext } = await decrypt(
    keyring,
    Buffer.from(bundle.ciphertext, "base64")
  );
  return plaintext;
}
