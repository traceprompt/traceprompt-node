import patterns from "../idPatterns.json";
import { Recognizer, Entity } from "../../types";
import {
  dniCheck,
  inseeCheck,
  beEidCheck,
  luhn10,
  nhsMod11,
  svnrMod11,
  imeiLuhn,
  npiLuhn,
} from "../utils/checksums";

type IdRule = {
  type: string;
  regex: string;
  context?: string[];
  validate?: string | null;
};

const compiled = (patterns as IdRule[]).map((rule) => ({
  ...rule,
  re: new RegExp(rule.regex, "gu"),
}));

const validators = {
  dniCheck,
  inseeCheck,
  beEidCheck,
  luhn10,
  nhsMod11,
  svnrMod11,
  imeiLuhn,
  npiLuhn,
};

export const idRecognizer: Recognizer = {
  id: "nat-id",
  detect(text, map) {
    const out: Entity[] = [];
    for (const rule of compiled) {
      for (const m of text.matchAll(rule.re)) {
        // 1️⃣ context guard
        if (rule.context) {
          const contextPattern = new RegExp(rule.context.join("|"), "i");
          // Check both before and after for context (±25 chars for longer words)
          const contextWindow = text.slice(
            Math.max(0, m.index! - 25),
            m.index! + m[0].length + 25
          );
          if (!contextPattern.test(contextWindow)) continue;

          // Special case: reject EIN if routing/aba context is present
          if (
            rule.type === "EIN" &&
            /routing|aba|acct|checking|bank/i.test(contextWindow)
          )
            continue;
        }

        // 2️⃣ checksum validation (affects confidence, doesn't reject)
        let confidence = 0.9;
        if (rule.validate) {
          const validator = (validators as any)[rule.validate];
          // Clean number: remove spaces, Unicode dashes, dots, slashes
          const cleanNum = m[0].replace(
            /[\s\u002D\u2010\u2011\u2012\u2013\u2014\u2015.-/]/g,
            ""
          );
          if (validator && !validator(cleanNum)) {
            confidence = 0.7; // Lower confidence for invalid checksum, but still detect
          }
        }

        out.push({
          type: rule.type as any,
          start: map.origPos(m.index!),
          end: map.origPos(m.index! + m[0].length),
          text: m[0],
          confidence,
          source: this.id,
          risk: "critical" as const,
        });
      }
    }
    return out;
  },
};
