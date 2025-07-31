import { OffsetMap } from "../types";

export function preprocess(raw: string): { text: string; map: OffsetMap } {
  const norm = raw.normalize("NFC");
  let cleaned = "";
  const idx: number[] = [];
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i];
    if (/\s/.test(ch)) {
      if (cleaned[cleaned.length - 1] !== " ") {
        cleaned += " ";
        idx.push(i);
      }
    } else {
      cleaned += ch;
      idx.push(i);
    }
  }
  const map: OffsetMap = {
    origPos(n: number) {
      return idx[n] ?? n;
    },
  };
  return { text: cleaned, map };
}
