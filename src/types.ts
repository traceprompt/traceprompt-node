export interface TracePromptInit {
  dataDir?: string;
  apiKey: string;
  cmkArn?: string; // Optional - can be auto-resolved from API key
  ingestUrl: string;
  batchSize?: number;
  flushIntervalMs?: number;
  staticMeta?: Record<string, unknown>;
  logLevel?: "error" | "warn" | "info" | "verbose" | "debug" | "silly";
}

export interface WrapOpts {
  modelVendor:
    | "openai"
    | "anthropic"
    | "grok"
    | "gemini"
    | "mistral"
    | "deepseek"
    | "xai"
    | "local";
  modelName: string;
  userId?: string;
}

export interface EncryptedBundle {
  ciphertext: string;
  encryptedDataKey: string;
  suiteId?: number;
}

export interface QueueItem {
  payload: Record<string, unknown> & { enc: EncryptedBundle };
  leafHash: string;
}

export type EntityType =
  | "FULL_NAME"
  | "FIRST_NAME"
  | "EMAIL"
  | "PHONE"
  | "CREDIT_CARD"
  | "CREDIT_CARD_PARTIAL"
  | "SSN"
  | "PASSPORT"
  | "ADDRESS"
  | "POSTCODE"
  | "IP"
  | "IBAN"
  | "SWIFT_BIC"
  | "NINO"
  | "UK_BANK_ACCT"
  | "US_ROUTING"
  | "INSURANCE_ID"
  | "MEDICAL_ID"
  | "NHS_NUMBER"
  | "DOB"
  | "DRIVER_LICENSE"
  | "DNI"
  | "INSEE_SSN"
  | "EIN"
  | "EU_NATIONAL_ID"
  | "UK_DL"
  | "ON_DL"
  | "PERSONNUMMER"
  | "CA_SIN"
  | "NHS_NUMBER"
  | "MBI"
  | "NPI"
  | "ON_HEALTH"
  | "SVNR"
  | "MAC_ADDRESS"
  | "IMEI"
  | "BANK_ACCOUNT";

export type RiskLevel = "critical" | "sensitive" | "general";

export interface Entity {
  type: EntityType;
  start: number;
  end: number;
  text: string;
  confidence: number;
  source: string;
  risk: RiskLevel;
}

export interface OffsetMap {
  origPos(n: number): number;
}

export interface Recognizer {
  id: string;
  detect(text: string, map: OffsetMap): Entity[];
}
