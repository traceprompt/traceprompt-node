/**
 * v1 bundle ⇢ JSON → base64
 *
 * {
 *   v:   '1',
 *   dek: <base64>,                   // wrapped data-encryption key
 *   ct:  <base64>,                   // ciphertext (AWS SDK binary → base64)
 *   ctx: { ...encryptionContext }    // full EC map used for encrypt()
 *   suite:  <number>                 // optional diagnostics
 * }
 */
export interface EncV1 {
  v: "1";
  dek: string;
  ct: string;
  ctx: Record<string, string>;
  suite?: number;
}

// helper
export function encodeBundle(obj: EncV1): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}
export function decodeBundle(b64: string): EncV1 {
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as EncV1;
}
