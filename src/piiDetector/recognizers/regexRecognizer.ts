import { Recognizer, Entity } from "../../types";
import { luhnValid } from "../utils/luhn";
import { abaValid } from "../utils/aba";

// ─── Structured PII patterns ────────────────────────────────────────────
const EMAIL_RE = /\b[\w.%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu;
const PHONE_RE =
  /(?<!account\s)(?<!sort\s?code\s)(?:\+?\d{1,3}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]?)?(?:\(\d{2,4}\)|\d{2,4})[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]?\d{3,4}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]?\d{3,4}(?!\s+\d{4})\b/gu;
const SSN_RE =
  /\b\d{3}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015-]\d{2}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015-]\d{4}\b/gu;
const IPV4_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/gu;

const VISA_RE = /\b4\d{12}(\d{3})?\b/gu;
const AMEX_RE = /\b3[47]\d{13}\b/gu;
const CC_GROUP_RE = /\b(?:\d{4}[-\s]?){3}\d{4}\b/gu;
// Generic PAN: flexible format with Unicode separators (covers all dash variants)
const PAN_GENERIC_RE =
  /\b\d{4}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]\d{4}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]\d{4}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]\d{3,7}\b/gu;
// Masked PANs: partial credit card with last 4 digits visible
const PAN_MASKED_RE =
  /\b\d{4}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]?\d{2}\*{2}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]?\*{4}[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\s-]?\d{4}\b/gu;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ \dA-Z]){11,30}\b/gu;
const SWIFT_RE = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gu;
const ROUTING_RE =
  /\b\d{3}[\s-]?\d{6}(?=\s*(?:routing|aba))|(?:routing|aba)\s+\d{3}[\s-]?\d{6}\b/giu; // ABA routing with context, handles whitespace

const SORT_ACC_RE = /\b\d{2}-\d{2}-\d{2}(?:\s+\w+){0,4}?\s*\d{8}\b/gi;
const ACCT_RE = /(?:acct|account)\s+\d{8,12}\b/gi; // Account numbers with context
const POSTCODE_RE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/gi;
const NINO_RE = /\b[ABCEGHJ-PRSTW-ZQ]{2}\d{6}[A-D]\b/gi; // “QQ…” allowed for tests
const PASSPORT_RE = /\b(?:[A-Z]{1,2}\d{7}|[A-Z]\d{8}|[A-Z0-9]{9}|\d{9})\b/gu; // Passport: various formats including mixed alphanumeric
const DL_RE = /\b\d{8,15}[A-Z]{0,2}\b/gu;
const DL_CA_RE = /\bD\d{7}\b/gu; // California DL format

// NHS patterns moved to idRecognizer with context + checksum validation
const MAC_RE = /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi;
const IMEI_RE = /\b\d{15}\b/g;
const MRN_RE = /\b(?:MRN|Patient\s*(?:ID|No\.?))\s*#?\s*\d{6,10}\b/gi;
const DOB_RE =
  /\b(?:DOB|Date\s*of\s*birth|D\.O\.B\.?)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi;
const INS_RE =
  /\b(?:policy|member|insurance)\s*(?:id|no|number|#)\s*[:\-]?\s*[A-Z0-9]{3,}(?:[-–][A-Z0-9]{2,})?(?=\b|[,.;])(?!\s*card)\b/gi;

// ─── Helper ─────────────────────────────────────────────────────────────
function push(
  out: Entity[],
  type: Entity["type"],
  m: RegExpMatchArray,
  map: any,
  conf = 1
) {
  out.push({
    type,
    start: map.origPos(m.index!),
    end: map.origPos(m.index! + m[0].length),
    text: m[0],
    confidence: conf,
    source: "regex",
    risk: "general" as const,
  });
}

function overlapsExisting(list: Entity[], s: number, e: number): boolean {
  return list.some((x) => !(e <= x.start || s >= x.end));
}

// ─── Exported recogniser ────────────────────────────────────────────────
export const regexRecognizer: Recognizer = {
  id: "regex",
  detect(text, map) {
    const out: Entity[] = [];

    // basic patterns
    for (const m of text.matchAll(EMAIL_RE)) push(out, "EMAIL", m, map);
    for (const m of text.matchAll(SSN_RE)) push(out, "SSN", m, map, 0.98);
    for (const m of text.matchAll(IPV4_RE)) push(out, "IP", m, map, 0.95);

    // ABA routing (promote before phone to avoid conflicts)
    for (const m of text.matchAll(ROUTING_RE)) {
      const contextWindow = text.slice(
        Math.max(0, m.index! - 10),
        m.index! + m[0].length + 15
      );
      if (/routing|aba/i.test(contextWindow)) {
        if (abaValid(m[0])) push(out, "US_ROUTING", m, map, 0.9);
      }
    }

    // finance / IDs
    for (const m of text.matchAll(VISA_RE))
      if (luhnValid(m[0])) push(out, "CREDIT_CARD", m, map, 0.95);
    for (const m of text.matchAll(AMEX_RE))
      if (luhnValid(m[0])) push(out, "CREDIT_CARD", m, map, 0.95);
    for (const m of text.matchAll(CC_GROUP_RE)) {
      const digits = m[0].replace(/\D+/g, "");
      if (digits.length === 16 && luhnValid(digits)) {
        push(out, "CREDIT_CARD", m, map, 0.95);
      }
    }
    // Generic PAN: covers Discover, JCB, fancy dashes, etc.
    for (const m of text.matchAll(PAN_GENERIC_RE)) {
      const digits = m[0].replace(/\D+/g, "");
      // Ignore if <13 or >19 digits (after stripping separators)
      if (digits.length < 13 || digits.length > 19) continue;
      // Skip masked cards containing '*' or 'x'
      if (/[\*x]/i.test(m[0])) continue;
      if (luhnValid(digits)) {
        // Prevent duplicate if already captured by VISA_RE/AMEX_RE/CC_GROUP_RE
        if (
          !overlapsExisting(
            out,
            map.origPos(m.index!),
            map.origPos(m.index! + m[0].length)
          )
        )
          push(out, "CREDIT_CARD", m, map, 0.95);
      }
    }
    // Masked credit cards (optional - lower confidence)
    for (const m of text.matchAll(PAN_MASKED_RE)) {
      if (
        !overlapsExisting(
          out,
          map.origPos(m.index!),
          map.origPos(m.index! + m[0].length)
        )
      )
        push(out, "CREDIT_CARD_PARTIAL", m, map, 0.7);
    }
    for (const m of text.matchAll(IBAN_RE)) push(out, "IBAN", m, map, 0.9);
    for (const m of text.matchAll(SWIFT_RE))
      push(out, "SWIFT_BIC", m, map, 0.9);
    for (const m of text.matchAll(SORT_ACC_RE))
      push(out, "UK_BANK_ACCT", m, map, 0.9);
    for (const m of text.matchAll(NINO_RE)) push(out, "NINO", m, map, 0.9);
    for (const m of text.matchAll(ROUTING_RE))
      push(out, "US_ROUTING", m, map, 0.9);
    for (const m of text.matchAll(ACCT_RE))
      push(out, "BANK_ACCOUNT", m, map, 0.85);

    // device identifiers (before phone to avoid conflicts)
    for (const m of text.matchAll(MAC_RE)) {
      const ctx = text.slice(
        Math.max(0, m.index! - 10),
        m.index! + m[0].length + 10
      );
      if (/mac|address|ethernet|wifi|device/i.test(ctx)) {
        push(out, "MAC_ADDRESS", m, map, 0.85);
      }
    }
    for (const m of text.matchAll(IMEI_RE)) {
      const ctx = text.slice(
        Math.max(0, m.index! - 10),
        m.index! + m[0].length + 10
      );
      if (/imei|device|phone|mobile/i.test(ctx)) {
        push(out, "IMEI", m, map, 0.9);
      }
    }

    // phone with overlap and context guards
    for (const m of text.matchAll(PHONE_RE)) {
      const digits = m[0].replace(/\D+/g, "");
      if (digits.length < 9 || digits.length > 12) continue; // skip CCNs
      if (
        overlapsExisting(
          out,
          map.origPos(m.index!),
          map.origPos(m.index! + m[0].length)
        )
      )
        continue;
      const pre = text
        .slice(Math.max(0, m.index! - 10), m.index!)
        .toLowerCase();
      if (
        /aba\s|acct\s|routing\s|checking\s|sin\s|ein\s|insee\s|dni\s|nhs\s|mbi\s|npi\s|svnr\s|ohip\s|medicare\s|mac\s|imei\s|member\s|plan\s|policy\s|insurance\s/.test(
          pre
        )
      )
        continue;
      push(out, "PHONE", m, map, 0.9);
    }

    // documents / personal IDs
    for (const m of text.matchAll(PASSPORT_RE)) {
      const ctx = text.slice(
        Math.max(0, m.index! - 15),
        m.index! + m[0].length + 5
      );
      if (/passport|passeport|travel|document|P<|pièce/i.test(ctx)) {
        push(out, "PASSPORT", m, map, 0.9);
      }
    }
    for (const m of text.matchAll(DL_RE)) {
      const ctx = text.slice(Math.max(0, m.index! - 12), m.index!);
      if (/\bDL\b|driver|licen[cs]e/i.test(ctx))
        push(out, "DRIVER_LICENSE", m, map, 0.8);
    }
    // California DL
    for (const m of text.matchAll(DL_CA_RE)) {
      const ctx = text.slice(Math.max(0, m.index! - 10), m.index!);
      if (/\bDL\b|driver/i.test(ctx)) push(out, "DRIVER_LICENSE", m, map, 0.8);
    }

    // health (NHS moved to idRecognizer)
    for (const m of text.matchAll(MRN_RE)) push(out, "MEDICAL_ID", m, map, 0.9);
    for (const m of text.matchAll(DOB_RE)) push(out, "DOB", m, map, 0.85);
    for (const m of text.matchAll(INS_RE))
      push(out, "INSURANCE_ID", m, map, 0.8);

    // misc
    for (const m of text.matchAll(POSTCODE_RE))
      push(out, "POSTCODE", m, map, 0.7);

    return out;
  },
};
