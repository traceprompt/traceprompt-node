import { Recognizer, Entity } from "../../types";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";
// @ts-ignore - wink-nlp internal module without types
import its from "wink-nlp/src/its.js";
import { isLikelyNotAName } from "./compromiseRecognizer";

const nlp = winkNLP(model);

// Common name prefixes and suffixes for validation
const NAME_PREFIXES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "professor",
  "sir",
  "lady",
  "lord",
  "rev",
  "father",
  "sister",
  "brother",
  "captain",
  "major",
  "colonel",
  "general",
  // Additional titles from feedback
  "sen",
  "rep",
  "judge",
  "officer",
  "sgt",
  "st", // Saint
  "detective",
  "deputy",
  "chief",
]);

const NAME_SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "phd",
  "md",
  "esq",
  "cpa",
  "rn",
]);

// Helper function to build optimized stop-list
const buildStopSet = (words: string[]) =>
  new Set(words.map((w) => w.toLowerCase()));

// Common words that look like names but aren't (reduce false positives)
const COMMON_WORDS_RAW = [
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "let",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  // Days and months
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  // Common false positives
  "email",
  "phone",
  "address",
  "contact",
  "company",
  "team",
  "group",
  "department",
  "office",
  "building",
  "hello",
  "thanks",
  "please",
  "regards",
  "best",
  "dear",
  "sincerely",
  "yours",
  "welcome",
  "goodbye",
  "meeting",
  "call",
  "conference",
  "session",
  "appointment",
  "interview",
  "discussion",
  // Additional words commonly flagged as false positives
  "close",
  "update",
  "delete",
  "create",
  "remove",
  "add",
  "set",
  "get",
  "help",
  "show",
  "view",
  "open",
  "save",
  "load",
  "send",
  "receive",
  "submit",
  "cancel",
  "confirm",
  "approve",
  "reject",
  "start",
  "stop",
  "pause",
  "resume",
  "finish",
  "complete",
  "begin",
  "end",
  "first",
  "last",
  "next",
  "previous",
  "new",
  "old",
  "current",
  "active",
  "inactive",
  "enable",
  "disable",
  "activate",
  "deactivate",
  "strong",
  "weak",
  "authentication",
  "authorization",
  "security",
  "privacy",
  "policy",
  "terms",
  "conditions",
  "agreement",
  "contract",
  "service",
  "services",
  "product",
  "products",
  "item",
  "items",
  // Acronyms commonly mistaken for names
  "uk",
  "us",
  "eu",
  "api",
  "url",
  "uri",
  "sql",
  "xml",
  "json",
  "csv",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "rar",
  "tar",
  "gz",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "svg",
  "mp3",
  "mp4",
  "avi",
  "mov",
  "wmv",
  "flv",
  "mkv",
  "aml",
  "foi",
  "sar",
  "gdpr",
  "ccpa",
  "hipaa",
  "pci",
  "dss",
  "sox",
  "iso",
  "nist",
  "otp",
  "sms",
  "mfa",
  "2fa",
  "pin",
  "atm",
  "pos",
  "ach",
  "wire",
  "eft",
  "swift",
  "iban",
  "bic",
  "aba",
  "routing",
  "sort",
  "code",
  "account",
  "balance",
  "deposit",
  "withdrawal",
  "transfer",
  "payment",
  "transaction",
  "fee",
  "charge",
  "refund",
  "credit",
  "debit",
];

// Build optimized case-folded stop-list at module load time
const COMMON_WORDS = buildStopSet(COMMON_WORDS_RAW);

// Unicode-aware patterns for international names
const WORD = "[\\p{Lu}][\\p{L}''-]{1,19}"; // Supports accents & apostrophes
const PARTICLE = "(?:d[eu]|van|von|der|den|le|la)"; // Lowercase particles

// Pattern for potential names: Unicode-aware capitalized words
const POTENTIAL_NAME_PATTERN = new RegExp(`\\b${WORD}\\b`, "gu");

// Pattern for full names with particle support (van der Waals, O'Connor, Müller)
const FULL_NAME_PATTERN = new RegExp(
  `\\b${WORD}(?:\\s+(?:${PARTICLE}|${WORD})){1,3}\\b`,
  "gu"
);

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase()); // Still need toLowerCase for input normalization
}

function overlapsExisting(
  entities: Entity[],
  start: number,
  end: number
): boolean {
  return entities.some(
    (entity) => !(end <= entity.start || start >= entity.end)
  );
}

function hasNameContext(text: string, start: number, end: number): boolean {
  // Look for name context before and after the potential name
  const beforeText = text.slice(Math.max(0, start - 20), start).toLowerCase();
  const afterText = text
    .slice(end, Math.min(text.length, end + 20))
    .toLowerCase();

  // Positive name indicators
  const nameIndicators = [
    "name",
    "called",
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "patient",
    "client",
    "customer",
    "contact",
    "person",
    "individual",
    "employee",
    "staff",
    "user",
    "by",
    "with",
    "meet",
    "meeting",
    "see",
    "visit",
    "talk",
    "speak",
    "discuss",
    "and",
  ];

  // Negative indicators (contexts where capitalized words are likely not names)
  const negativeIndicators = [
    "company",
    "corp",
    "inc",
    "ltd",
    "llc",
    "organization",
    "department",
    "team",
    "product",
    "service",
    "brand",
    "model",
    "version",
    "system",
    "software",
    "app",
    "member",
    "plan",
    "policy",
    "insurance",
    "card",
    "account",
  ];

  const contextText = beforeText + " " + afterText;

  // Check for negative indicators first (stronger signal)
  if (negativeIndicators.some((indicator) => contextText.includes(indicator))) {
    return false;
  }

  // Check for positive indicators
  return nameIndicators.some((indicator) => contextText.includes(indicator));
}

export const nameRecognizer: Recognizer = {
  id: "name-pattern",
  detect(text, map) {
    const entities: Entity[] = [];

    // First, detect full names (higher confidence)
    const fullNameMatches = [...text.matchAll(FULL_NAME_PATTERN)];
    for (const match of fullNameMatches) {
      const fullName = match[0];
      const words = fullName.split(/\s+/);

      // Skip if any word is a common word
      if (words.some((word) => isCommonWord(word))) continue;

      // Use compromise.js to check if this looks like a business name or non-person entity
      if (isLikelyNotAName(fullName, text)) continue;

      // Check for name context or prefixes/suffixes
      const hasContext = hasNameContext(
        text,
        match.index!,
        match.index! + fullName.length
      );
      const hasPrefix = NAME_PREFIXES.has(words[0].toLowerCase());
      const hasSuffix = NAME_SUFFIXES.has(
        words[words.length - 1].toLowerCase()
      );

      if (hasContext || hasPrefix || hasSuffix) {
        entities.push({
          type: "FULL_NAME",
          start: map.origPos(match.index!),
          end: map.origPos(match.index! + fullName.length),
          text: fullName,
          confidence: hasPrefix || hasSuffix ? 0.9 : 0.75,
          source: this.id,
          risk: "sensitive" as const,
        });
      }
    }

    // Then detect single names (lower confidence, more context required)
    const singleNameMatches = [...text.matchAll(POTENTIAL_NAME_PATTERN)];
    for (const match of singleNameMatches) {
      const word = match[0];

      // Skip common words
      if (isCommonWord(word)) continue;

      // Skip if already covered by full name detection
      const alreadyCovered = entities.some(
        (entity) =>
          match.index! >= entity.start &&
          match.index! + word.length <= entity.end
      );
      if (alreadyCovered) continue;

      // Use compromise.js to check if this is likely not a name (verb, adjective, etc.)
      if (isLikelyNotAName(word, text)) continue;

      // Require strong context for single names
      if (hasNameContext(text, match.index!, match.index! + word.length)) {
        entities.push({
          type: "FIRST_NAME",
          start: map.origPos(match.index!),
          end: map.origPos(match.index! + word.length),
          text: word,
          confidence: 0.6, // Lower confidence for single names
          source: this.id,
          risk: "sensitive" as const,
        });
      }
    }

    // Add wink-nlp overlap guard for names missed by regex
    const doc = nlp.readDoc(text);
    const winkPersons = doc
      .entities()
      .out(its.detail)
      .filter((e: any) => e.type === "PERSON")
      .map((e: any) => ({
        start: map.origPos(e.start),
        end: map.origPos(e.end),
        text: text.slice(e.start, e.end),
        type: "FULL_NAME" as const,
        confidence: 0.85,
        source: "wink-backup",
        risk: "sensitive" as const,
      }));

    // Merge wink results, avoiding overlaps with regex results
    for (const winkEntity of winkPersons) {
      if (!overlapsExisting(entities, winkEntity.start, winkEntity.end)) {
        entities.push(winkEntity);
      }
    }

    return entities;
  },
};
