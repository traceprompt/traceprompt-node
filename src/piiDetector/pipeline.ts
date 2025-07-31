import { preprocess } from "./preprocessor";
import { Entity, EntityType, RiskLevel } from "../types";
import { regexRecognizer } from "./recognizers/regexRecognizer";
import { nerRecognizer } from "./recognizers/nerRecognizer";
import { idRecognizer } from "./recognizers/idRecognizer";
import { nameRecognizer } from "./recognizers/nameRecognizer";

const RECOGNIZERS = [
  regexRecognizer, // basic patterns including structured IDs with context guards
  idRecognizer, // national ID patterns with context + checksum validation
  nameRecognizer, // capitalization-based name detection with context validation
  nerRecognizer, // wink-nlp: PERSON + LOCATION (backup for names missed by pattern matching)
];

// Risk level mapping for PII types
const RISK_LEVELS: Record<EntityType, RiskLevel> = {
  // Critical: Government IDs, payment info, auth secrets
  SSN: "critical",
  CREDIT_CARD: "critical",
  CREDIT_CARD_PARTIAL: "sensitive",
  PASSPORT: "critical",
  NINO: "critical",
  UK_BANK_ACCT: "critical",
  US_ROUTING: "critical",
  IBAN: "critical",
  SWIFT_BIC: "critical",
  DNI: "critical",
  INSEE_SSN: "critical",
  EIN: "critical",
  EU_NATIONAL_ID: "critical",
  UK_DL: "sensitive",
  ON_DL: "sensitive",
  PERSONNUMMER: "critical",
  CA_SIN: "critical",
  NHS_NUMBER: "critical",
  MBI: "critical",
  NPI: "sensitive",
  ON_HEALTH: "critical",
  SVNR: "critical",
  MAC_ADDRESS: "sensitive",
  IMEI: "sensitive",
  BANK_ACCOUNT: "critical",

  // Sensitive: Personal info, medical records
  FIRST_NAME: "sensitive",
  FULL_NAME: "sensitive",
  EMAIL: "sensitive",
  PHONE: "sensitive",
  ADDRESS: "sensitive",
  MEDICAL_ID: "sensitive",
  DOB: "sensitive",
  DRIVER_LICENSE: "sensitive",
  INSURANCE_ID: "sensitive",

  // General: Less sensitive context
  IP: "general",
  POSTCODE: "general",
};

function addRiskLevel(entity: Omit<Entity, "risk">): Entity {
  return {
    ...entity,
    risk: RISK_LEVELS[entity.type],
  };
}

export function detectPII(raw: string): Entity[] {
  const { text, map } = preprocess(raw);
  let spans: Entity[] = [];
  for (const r of RECOGNIZERS) {
    const detected = r.detect(text, map);
    spans = spans.concat(detected.map(addRiskLevel));
  }
  spans.sort((a, b) => a.start - b.start || b.confidence - a.confidence);
  const merged: Entity[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) {
      // Smart overlap resolution: prefer ID patterns over phone patterns
      if (s.source === "nat-id" && last.type === "PHONE") {
        merged[merged.length - 1] = s; // Replace phone with national ID
      }
      continue;
    }
    merged.push(s);
  }
  return merged;
}
