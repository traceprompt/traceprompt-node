/**
 * keyring/index.ts
 * --------------------------------------------------
 * Builds a keyring that the Encryption SDK will use
 * for envelope-encrypt / decrypt.
 *
 * • In production: returns a KmsKeyringNode pointing
 *   at the customer’s CMK (ARN).
 * • In local-dev: returns a RawAesKeyringNode that
 *   wraps data-keys with a 256-bit hex key read from
 *   LOCAL_DEV_KEK.
 * --------------------------------------------------
 */

import {
  AlgorithmSuiteIdentifier,
  KmsKeyringNode,
  RawAesKeyringNode,
} from "@aws-crypto/client-node";
import { ConfigManager } from "../config";

export type AnyKeyring = KmsKeyringNode | RawAesKeyringNode;

export function buildKeyring(): AnyKeyring {
  const { cmkArn } = ConfigManager.cfg;

  /* ---------- Local-dev path ---------- */
  if (cmkArn === "local-dev") {
    const hex = process.env.LOCAL_DEV_KEK;
    if (!hex || hex.length !== 64) {
      throw new Error(
        'LOCAL_DEV_KEK (64-char hex) must be set when cmkArn="local-dev"'
      );
    }
    return new RawAesKeyringNode({
      keyName: "dev",
      keyNamespace: "traceprompt",
      unencryptedMasterKey: Buffer.from(hex, "hex"),
      wrappingSuite: AlgorithmSuiteIdentifier.ALG_AES256_GCM_IV12_TAG16,
    });
  }

  /* ---------- AWS KMS path ---------- */
  return new KmsKeyringNode({
    generatorKeyId: cmkArn,
  });
}
