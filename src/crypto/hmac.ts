import { createHmac } from "crypto";

/**
 * Deterministic JSON stringify with sorted keys
 */
function deterministicStringify(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map(deterministicStringify).join(",") + "]";
  }

  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (key) => JSON.stringify(key) + ":" + deterministicStringify(obj[key])
  );

  return "{" + pairs.join(",") + "}";
}

/**
 * Generate HMAC-SHA256 signature for a payload
 * @param payload - The data to sign (will be JSON stringified with sorted keys)
 * @param secret - The HMAC secret (base64 encoded)
 * @returns HMAC signature as hex string
 */
export function generateHmacSignature(payload: any, secret: string): string {
  const payloadString = deterministicStringify(payload);
  const secretBuffer = Buffer.from(secret, "base64");

  return createHmac("sha256", secretBuffer).update(payloadString).digest("hex");
}
