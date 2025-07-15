import { blake3 } from "@napi-rs/blake-hash";

export function computeLeaf(data: string | Buffer | undefined): string {
  if (data === undefined) {
    data = "null";
  }
  return blake3(data).toString("hex");
}
