/**
 * keyring/index.ts
 * ------------------------------------------------------
 * Returns an AWS Encryption SDK keyring appropriate for
 * the current execution context.
 *
 * • Production  → KmsKeyringNode wrapping the customer's CMK.
 * • Local dev   → RawAesKeyringNode using LOCAL_DEV_KEK.
 *
 * The keyring is constructed on every call so long-running
 * processes can pick up CMK rotation without restart.
 * ------------------------------------------------------
 */

import {
  KmsKeyringNode,
  RawAesKeyringNode,
  RawAesWrappingSuiteIdentifier,
} from "@aws-crypto/client-node";
import { ConfigManager } from "../config";

export type AnyKeyring = KmsKeyringNode | RawAesKeyringNode;

/**
 * Build a keyring based on the resolved configuration.
 * Throws if prerequisites (e.g. LOCAL_DEV_KEK) are missing.
 */
export function buildKeyring(): AnyKeyring {
  const { cmkArn } = ConfigManager.cfg;

  /* ---------- Local-dev path ----------------------------------- */
  if (cmkArn === "local-dev") {
    const hex = process.env["LOCAL_DEV_KEK"];
    if (!hex || hex.length !== 64) {
      throw new Error(
        'TracePrompt: LOCAL_DEV_KEK (64-char hex) must be set when cmkArn="local-dev"'
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
