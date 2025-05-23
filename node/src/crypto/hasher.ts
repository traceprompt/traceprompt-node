import blake3 from "blake3";

export function computeLeaf(payload: string): string {
  return blake3.hash(payload).toString("hex"); // 32-byte hex
}
