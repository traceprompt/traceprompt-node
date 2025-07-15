import { KmsKeyringNode, RawAesKeyringNode } from "@aws-crypto/client-node";
import { ConfigManager } from "../config";

export type AnyKeyring = KmsKeyringNode | RawAesKeyringNode;

export function buildKeyring(): AnyKeyring {
  const { cmkArn } = ConfigManager.cfg;

  return new KmsKeyringNode({
    generatorKeyId: cmkArn,
  });
}
