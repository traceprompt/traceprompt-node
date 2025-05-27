import {
  KmsKeyringNode,
  RawAesKeyringNode,
  RawAesWrappingSuiteIdentifier,
} from "@aws-crypto/client-node";
import { ConfigManager } from "../config";

export type AnyKeyring = KmsKeyringNode | RawAesKeyringNode;

export function buildKeyring(): AnyKeyring {
  const { cmkArn } = ConfigManager.cfg;

  if (cmkArn === "local-dev") {
    const hex = process.env["LOCAL_DEV_KEK"];
    if (!hex || hex.length !== 64) {
      throw new Error(
        'Traceprompt: LOCAL_DEV_KEK (64-char hex) must be set when cmkArn="local-dev"'
      );
    }

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

  return new KmsKeyringNode({
    generatorKeyId: cmkArn,
  });
}
