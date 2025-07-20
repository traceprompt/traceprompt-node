import nlp from "compromise";
import { piiGuard, SelectionType } from "@presidio-dev/hai-guardrails";

export interface PiiDetectionResult {
  piiDetected: boolean;
  piiTypes: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  entities: Array<{
    type: string;
    start: number;
    end: number;
    text: string;
    source:
      | "presidio"
      | "compromise"
      | "custom_medical"
      | "custom_finance"
      | "custom_government";
  }>;
}

// Domain-specific PII patterns
const MEDICAL_PHI_PATTERNS = [
  { entity: "MRN", regex: /\bMRN-\d{6,}\b/gi },
  {
    entity: "ICD10",
    regex: /\b[a-tv-zA-TV-Z]\d{2}(?:\.[A-Za-z0-9]{1,4})?\b/gi,
  },
  { entity: "HEALTH_INSURANCE_ID", regex: /\bHI-\d{9}\b/gi },
  { entity: "LAB_VALUE", regex: /\b\d+(?:\.\d+)?\s?mg\/dL\b/gi },
  { entity: "PATIENT_ID", regex: /\bPID-\d{6,}\b/gi },
  { entity: "PRESCRIPTION_NUMBER", regex: /\bRX-\d{6,}\b/gi },
  { entity: "MEDICARE_ID", regex: /\bMED-\d{9}\b/gi },
  { entity: "ADMISSION_NUMBER", regex: /\bADM-\d{6,}\b/gi },
  { entity: "BLOOD_TYPE", regex: /\b(?:A|B|AB|O)[+-]\b/g },
  {
    entity: "ALLERGY_INFO",
    regex: /\b(allergy|sensitivity)\s+to\s+[A-Za-z]+\b/gi,
  },
];

const FINANCE_PATTERNS = [
  { entity: "CREDIT_CARD", regex: /\b(?:\d[ -]*?){13,16}\b/g },
  { entity: "EXPIRY_DATE", regex: /\b(?:0[1-9]|1[0-2])\/?(?:\d{2}|\d{4})\b/g },
  { entity: "CVV", regex: /\b(?:CVV|CVC)[:\s]?\d{3,4}\b/gi },

  // US banking patterns
  {
    entity: "US_ROUTING",
    regex: /\b(?:routing)[\s#:–]*\d{9}\b/gi,
  },
  {
    entity: "ROUTING_NUMBER",
    regex: /\b(?:0[0-9]|1[0-2]|2[1-9]|3[0-2]|6[1-9]|7[0-2]|80)\d{7}\b/g,
  },
  // More specific bank account pattern - requires context words
  {
    entity: "BANK_ACCOUNT",
    regex: /\b(?:account|acct|bank|checking|savings)[\s#:\-]*\d{9,18}\b/gi,
  },

  // UK banking patterns
  {
    entity: "UK_SORT_CODE",
    regex: /\b(?:sort|sort[-_]?code)[\s#:\-]*\d{2}[-]?\d{2}[-]?\d{2}\b/gi,
  },
  {
    entity: "UK_ACCOUNT",
    regex: /\b(?:account|acct)[\s#:\-]*\d{7,8}\b/gi,
  },

  // International banking (improved patterns)
  {
    entity: "IBAN",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{1,30}\b/gi,
  },
  {
    entity: "BIC",
    regex: /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,
  },
  { entity: "SWIFT", regex: /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g },
];

const GOVERNMENT_PII_PATTERNS = [
  { entity: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { entity: "UK_NINO", regex: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g },
  { entity: "UK_NHS", regex: /\b\d{3}\s\d{3}\s\d{4}\b/g },
  { entity: "CA_SIN", regex: /\b(?:\d{3}[-_]\d{3}[-_]\d{3}|\d{9})\b/g },
  { entity: "US_EIN", regex: /\b\d{2}-\d{7}\b/g },
  { entity: "US_PASSPORT", regex: /\b\d{9}\b/g },
];

// Specific address patterns that should always be flagged as PII
const ADDRESS_PII_PATTERNS = [
  // Street addresses with numbers
  {
    entity: "STREET_ADDRESS",
    regex:
      /\d{1,5}\s+[A-Za-z\s]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ct|Court|Ln|Lane|Way|Pl|Place|Cir|Circle|Ter|Terrace|Pkwy|Parkway|Hwy|Highway)\.?\b/gi,
  },

  // Apartment/Unit designations
  {
    entity: "APARTMENT",
    regex: /\b(?:Apt|Apartment|Unit|Suite|Ste|Floor|Fl)\.?\s+[A-Za-z0-9]+\b/gi,
  },

  // PO Box
  {
    entity: "PO_BOX",
    regex: /\b(?:P\.?O\.?\s+Box|Post\s+Office\s+Box)\s+\d+\b/gi,
  },

  // US ZIP codes (standalone or with city context)
  { entity: "ZIP_CODE", regex: /\b\d{5}(?:-\d{4})?\b/g },

  // UK postal codes
  { entity: "UK_POSTAL_CODE", regex: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g },

  // Canadian postal codes
  { entity: "CA_POSTAL_CODE", regex: /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/g },
];

// Additional name and title patterns
const NAME_PATTERNS = [
  {
    entity: "TITLE",
    regex: /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|PhD|MD|Esq)\.?\s+/gi,
  },
  {
    entity: "HONORIFIC",
    regex: /\b(?:Sir|Lady|Lord|Dame|The Honorable|Hon)\s+/gi,
  },
  { entity: "INITIALS", regex: /\b[A-Z]\.[A-Z]\.(?:\s*[A-Z]\.)*\b/g },
  {
    entity: "NAME_SUFFIX",
    regex: /\b(?:Jr|Sr|II|III|IV|V|PhD|MD|DDS|JD|Esq)\.?\b/gi,
  },
];

// Whitelist of major cities, countries, and regions that should NOT be considered PII
const LOCATION_WHITELIST = new Set([
  // Major world cities
  "tokyo",
  "london",
  "paris",
  "new york",
  "los angeles",
  "chicago",
  "houston",
  "philadelphia",
  "phoenix",
  "san antonio",
  "san diego",
  "dallas",
  "san jose",
  "austin",
  "jacksonville",
  "fort worth",
  "columbus",
  "charlotte",
  "san francisco",
  "indianapolis",
  "seattle",
  "denver",
  "washington",
  "boston",
  "el paso",
  "detroit",
  "nashville",
  "portland",
  "memphis",
  "oklahoma city",
  "las vegas",
  "louisville",
  "baltimore",
  "milwaukee",
  "albuquerque",
  "tucson",
  "fresno",
  "sacramento",
  "mesa",
  "kansas city",
  "atlanta",
  "long beach",
  "colorado springs",
  "raleigh",
  "miami",
  "virginia beach",
  "omaha",
  "oakland",
  "minneapolis",
  "tulsa",
  "arlington",
  "tampa",
  "new orleans",
  "wichita",
  "cleveland",
  "bakersfield",
  "aurora",
  "anaheim",
  "honolulu",
  "santa ana",
  "corpus christi",
  "riverside",
  "lexington",
  "stockton",
  "toledo",
  "st. paul",
  "newark",
  "greensboro",
  "plano",
  "henderson",
  "lincoln",
  "buffalo",
  "jersey city",
  "chula vista",
  "fort wayne",
  "orlando",
  "st. petersburg",
  "chandler",
  "laredo",
  "norfolk",
  "durham",
  "madison",
  "lubbock",
  "irvine",
  "winston-salem",
  "glendale",
  "garland",
  "hialeah",
  "reno",
  "chesapeake",
  "gilbert",
  "baton rouge",
  "irving",
  "scottsdale",
  "north las vegas",
  "fremont",
  "boise",
  "richmond",
  "san bernardino",
  "birmingham",
  "spokane",
  "rochester",
  "des moines",
  "modesto",
  "fayetteville",
  "tacoma",
  "oxnard",
  "fontana",
  "columbus",
  "montgomery",
  "moreno valley",
  "shreveport",
  "aurora",
  "yonkers",
  "akron",
  "huntington beach",
  "little rock",
  "augusta",
  "amarillo",
  "glendale",
  "mobile",
  "grand rapids",
  "salt lake city",
  "tallahassee",
  "huntsville",
  "grand prairie",
  "knoxville",
  "worcester",
  "newport news",
  "brownsville",
  "santa clarita",
  "providence",
  "fort lauderdale",
  "chattanooga",
  "tempe",
  "oceanside",
  "garden grove",
  "rancho cucamonga",
  "santa rosa",
  "port st. lucie",
  "ontario",
  "vancouver",
  "sioux falls",
  "peoria",
  "pembroke pines",
  "salem",
  "cape coral",
  "santa clara",
  "fort collins",
  "lansing",
  "coral springs",
  "stamford",
  "springfield",
  "columbia",
  "fargo",
  "elk grove",
  "rockford",
  "high point",
  "paterson",
  "miami gardens",
  "naperville",
  "bellevue",
  "joliet",
  "murfreesboro",
  "waterbury",
  "carrollton",
  "surprise",
  "sterling heights",
  "west valley city",
  "topeka",
  "concord",
  "thornton",
  "thousand oaks",
  "cedar rapids",
  "olathe",
  "norman",
  "columbia",
  "daly city",
  "dayton",
  "pearland",
  "rochester",
  "league city",
  "westminster",
  "lowell",
  "inglewood",
  "elgin",
  "miami beach",
  "arvada",
  "downey",
  "odessa",
  "midland",
  "pasadena",
  "melbourne",
  "palmdale",
  "independence",
  "beaumont",
  "murrieta",
  "ann arbor",
  "manchester",
  // Countries
  "usa",
  "united states",
  "america",
  "canada",
  "mexico",
  "brazil",
  "argentina",
  "chile",
  "colombia",
  "peru",
  "venezuela",
  "ecuador",
  "bolivia",
  "paraguay",
  "uruguay",
  "guyana",
  "suriname",
  "france",
  "germany",
  "italy",
  "spain",
  "portugal",
  "netherlands",
  "belgium",
  "switzerland",
  "austria",
  "sweden",
  "norway",
  "denmark",
  "finland",
  "poland",
  "czech republic",
  "slovakia",
  "hungary",
  "romania",
  "bulgaria",
  "greece",
  "turkey",
  "russia",
  "ukraine",
  "belarus",
  "lithuania",
  "latvia",
  "estonia",
  "ireland",
  "iceland",
  "united kingdom",
  "uk",
  "england",
  "scotland",
  "wales",
  "northern ireland",
  "china",
  "japan",
  "south korea",
  "north korea",
  "india",
  "pakistan",
  "bangladesh",
  "sri lanka",
  "nepal",
  "bhutan",
  "maldives",
  "afghanistan",
  "iran",
  "iraq",
  "syria",
  "lebanon",
  "jordan",
  "israel",
  "palestine",
  "saudi arabia",
  "uae",
  "kuwait",
  "qatar",
  "bahrain",
  "oman",
  "yemen",
  "egypt",
  "libya",
  "tunisia",
  "algeria",
  "morocco",
  "sudan",
  "ethiopia",
  "kenya",
  "uganda",
  "tanzania",
  "rwanda",
  "burundi",
  "somalia",
  "djibouti",
  "eritrea",
  "south africa",
  "botswana",
  "namibia",
  "zambia",
  "zimbabwe",
  "mozambique",
  "madagascar",
  "mauritius",
  "seychelles",
  "australia",
  "new zealand",
  "fiji",
  "papua new guinea",
  "solomon islands",
  "vanuatu",
  "samoa",
  "tonga",
  "palau",
  "micronesia",
  "marshall islands",
  "kiribati",
  "tuvalu",
  "nauru",
  // US States
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
  // Canadian Provinces/Territories
  "ontario",
  "quebec",
  "british columbia",
  "alberta",
  "manitoba",
  "saskatchewan",
  "nova scotia",
  "new brunswick",
  "newfoundland and labrador",
  "prince edward island",
  "northwest territories",
  "nunavut",
  "yukon",
  // Major European cities
  "madrid",
  "barcelona",
  "rome",
  "milan",
  "berlin",
  "hamburg",
  "munich",
  "amsterdam",
  "brussels",
  "zurich",
  "geneva",
  "vienna",
  "stockholm",
  "oslo",
  "copenhagen",
  "helsinki",
  "warsaw",
  "prague",
  "budapest",
  "bucharest",
  "sofia",
  "athens",
  "istanbul",
  "moscow",
  "saint petersburg",
  "kiev",
  "minsk",
  "vilnius",
  "riga",
  "tallinn",
  "dublin",
  "reykjavik",
  // Major Asian cities
  "beijing",
  "shanghai",
  "guangzhou",
  "shenzhen",
  "mumbai",
  "delhi",
  "bangalore",
  "hyderabad",
  "chennai",
  "kolkata",
  "seoul",
  "busan",
  "osaka",
  "kyoto",
  "yokohama",
  "bangkok",
  "singapore",
  "kuala lumpur",
  "jakarta",
  "manila",
  "ho chi minh city",
  "hanoi",
  "phnom penh",
  "yangon",
  "dhaka",
  "islamabad",
  "karachi",
  "lahore",
  "kathmandu",
  "colombo",
  // Continents and regions
  "africa",
  "asia",
  "europe",
  "north america",
  "south america",
  "antarctica",
  "oceania",
  "middle east",
  "far east",
  "southeast asia",
  "central asia",
  "eastern europe",
  "western europe",
  "northern europe",
  "southern europe",
  "central america",
  "caribbean",
  "scandinavia",
  "balkans",
  "caucasus",
  "siberia",
  "patagonia",
]);

// Address-level patterns that indicate a specific address (actual PII)
const ADDRESS_LEVEL_PATTERNS = [
  // Street addresses: "123 Main St", "456 Oak Avenue", etc.
  /\d{1,5}\s+[A-Za-z\s]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ct|Court|Ln|Lane|Way|Pl|Place|Cir|Circle|Ter|Terrace|Pkwy|Parkway|Hwy|Highway)\.?\b/gi,

  // Postal codes (US: 12345 or 12345-6789, UK: SW1A 1AA, Canada: K1A 0A6)
  /\b(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/g,

  // Apartment/Unit numbers: "Apt 123", "Unit 4B", "Suite 200"
  /\b(?:Apt|Apartment|Unit|Suite|Ste|Floor|Fl)\.?\s+[A-Za-z0-9]+\b/gi,

  // PO Box patterns
  /\b(?:P\.?O\.?\s+Box|Post\s+Office\s+Box)\s+\d+\b/gi,

  // Building numbers with common patterns
  /\b\d+[A-Za-z]?\s+(?:Building|Bldg)\.?\s+[A-Za-z0-9]+\b/gi,
];

// Function to check if text contains address-level indicators
function hasAddressLevelIndicators(text: string): boolean {
  return ADDRESS_LEVEL_PATTERNS.some((pattern) => pattern.test(text));
}

// Helper function to detect entities using custom regex patterns
function detectCustomPatterns(
  text: string,
  patterns: Array<{ entity: string; regex: RegExp }>,
  source: string
): PiiDetectionResult["entities"] {
  const entities: PiiDetectionResult["entities"] = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      entities.push({
        type: pattern.entity,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        source: source as any,
      });
    }
  }

  return entities;
}

// Helper function to detect entities using compromise.js
function detectCompromiseEntities(
  text: string
): PiiDetectionResult["entities"] {
  const entities: PiiDetectionResult["entities"] = [];
  const doc = nlp(text);

  // More specific name detection
  const people = doc.people();
  people.forEach((person: any) => {
    const personText = person.text().trim();
    const start = text.indexOf(personText);
    if (start !== -1) {
      // Split into individual name components
      const words = personText
        .split(/\s+/)
        .filter((word: string) => word.length > 0);

      if (words.length === 1) {
        // Single word - assume it's a first name
        entities.push({
          type: "FIRST_NAME",
          start: start,
          end: start + personText.length,
          text: personText,
          source: "compromise",
        });
      } else if (words.length >= 2) {
        // Multiple words - extract first and last name
        const firstName = words[0];
        const lastName = words[words.length - 1];

        // Add first name
        const firstNameStart = text.indexOf(firstName, start);
        if (firstNameStart !== -1) {
          entities.push({
            type: "FIRST_NAME",
            start: firstNameStart,
            end: firstNameStart + firstName.length,
            text: firstName,
            source: "compromise",
          });
        }

        // Add last name
        const lastNameStart = text.indexOf(lastName, start + firstName.length);
        if (lastNameStart !== -1) {
          entities.push({
            type: "LAST_NAME",
            start: lastNameStart,
            end: lastNameStart + lastName.length,
            text: lastName,
            source: "compromise",
          });
        }

        // Add middle names if any (for names with 3+ words)
        if (words.length > 2) {
          for (let i = 1; i < words.length - 1; i++) {
            const middleName = words[i];
            const middleNameStart = text.indexOf(middleName, start);
            if (middleNameStart !== -1) {
              entities.push({
                type: "MIDDLE_NAME",
                start: middleNameStart,
                end: middleNameStart + middleName.length,
                text: middleName,
                source: "compromise",
              });
            }
          }
        }
      }
    }
  });

  // Detect organizations
  const organizations = doc.organizations();
  organizations.forEach((org: any) => {
    const orgText = org.text();
    const start = text.indexOf(orgText);
    if (start !== -1) {
      entities.push({
        type: "ORGANIZATION",
        start: start,
        end: start + orgText.length,
        text: orgText,
        source: "compromise",
      });
    }
  });

  // Detect places/locations - only flag if they're not in whitelist AND contain address-level indicators
  const places = doc.places();
  places.forEach((place: any) => {
    const placeText = place.text().trim();
    const placeTextLower = placeText.toLowerCase();
    const start = text.indexOf(placeText);

    if (start !== -1) {
      // Skip if this is a whitelisted major city/country/region
      if (LOCATION_WHITELIST.has(placeTextLower)) {
        return; // Don't flag as PII
      }

      // Get surrounding context (50 chars before and after) to check for address indicators
      const contextStart = Math.max(0, start - 50);
      const contextEnd = Math.min(text.length, start + placeText.length + 50);
      const contextText = text.slice(contextStart, contextEnd);

      // Only flag as PII if there are address-level indicators in the context
      if (hasAddressLevelIndicators(contextText)) {
        entities.push({
          type: "LOCATION",
          start: start,
          end: start + placeText.length,
          text: placeText,
          source: "compromise",
        });
      }
    }
  });

  return entities;
}

// Helper function to extract entities from presidio results
function extractPresidioEntities(
  originalText: string,
  presidioResults: any[]
): PiiDetectionResult["entities"] {
  const entities: PiiDetectionResult["entities"] = [];

  // Handle different possible presidio response formats
  if (!presidioResults || presidioResults.length === 0) {
    return entities;
  }

  // Try to extract from different possible response formats
  for (const result of presidioResults) {
    // Check if it's a direct analysis result (array format)
    if (
      result.entity_type &&
      result.start !== undefined &&
      result.end !== undefined
    ) {
      entities.push({
        type: result.entity_type,
        start: result.start,
        end: result.end,
        text: originalText.slice(result.start, result.end),
        source: "presidio",
      });
    }
    // Check if it has modifiedMessage property
    else if (result.modifiedMessage && result.modifiedMessage.content) {
      // This would be the redacted format - we'd need to compare with original
      // For now, let's extract from analysis if available
      if (result.analysis && Array.isArray(result.analysis)) {
        for (const analysisResult of result.analysis) {
          if (
            analysisResult.entity_type &&
            analysisResult.start !== undefined
          ) {
            entities.push({
              type: analysisResult.entity_type,
              start: analysisResult.start,
              end: analysisResult.end,
              text: originalText.slice(
                analysisResult.start,
                analysisResult.end
              ),
              source: "presidio",
            });
          }
        }
      }
    }
  }

  return entities;
}

// Helper function to calculate risk level based on detected PII types
function calculatePiiRiskLevel(
  piiTypes: string[]
): "low" | "medium" | "high" | "critical" {
  if (piiTypes.length === 0) return "low";

  // Define risk levels for different PII types
  const criticalRisk = [
    "SSN",
    "CREDIT_CARD",
    "BANK_ACCOUNT",
    "ROUTING_NUMBER",
    "US_ROUTING",
    "UK_ACCOUNT",
    "MRN",
    "PATIENT_ID",
    "MEDICARE_ID",
    "PRESCRIPTION_NUMBER",
  ];

  const highRisk = [
    "HEALTH_INSURANCE_ID",
    "ADMISSION_NUMBER",
    "LAB_VALUE",
    "IBAN",
    "BIC",
    "SWIFT",
    "UK_SORT_CODE",
    "CVV",
    "US_PASSPORT",
    "UK_NINO",
    "CA_SIN",
    "STREET_ADDRESS",
    "APARTMENT",
    "PO_BOX",
    "ZIP_CODE",
    "UK_POSTAL_CODE",
    "CA_POSTAL_CODE",
  ];

  const mediumRisk = [
    "FIRST_NAME",
    "LAST_NAME",
    "MIDDLE_NAME",
    "FULL_NAME",
    "PHONE_NUMBER",
    "EMAIL_ADDRESS",
    "ICD10",
    "BLOOD_TYPE",
  ];

  // Check for critical risk types
  if (piiTypes.some((type) => criticalRisk.includes(type))) {
    return "critical";
  }

  // Check for high risk types
  if (piiTypes.some((type) => highRisk.includes(type))) {
    return "high";
  }

  // Check for medium risk types
  if (piiTypes.some((type) => mediumRisk.includes(type))) {
    return "medium";
  }

  // Everything else is low risk
  return "low";
}

// Singleton presidio guard
let presidioGuard: any = null;

function getPresidioGuard() {
  if (!presidioGuard) {
    presidioGuard = piiGuard({
      selection: SelectionType.All,
    });
  }
  return presidioGuard;
}

export async function detectPii(text: string): Promise<PiiDetectionResult> {
  if (!text || text.trim().length === 0) {
    return {
      piiDetected: false,
      piiTypes: [],
      riskLevel: "low",
      entities: [],
    };
  }

  try {
    const allEntities: PiiDetectionResult["entities"] = [];
    const piiTypesSet = new Set<string>();

    // 1. Run custom domain-specific detection
    const medicalEntities = detectCustomPatterns(
      text,
      MEDICAL_PHI_PATTERNS,
      "custom_medical"
    );
    const financeEntities = detectCustomPatterns(
      text,
      FINANCE_PATTERNS,
      "custom_finance"
    );
    const governmentEntities = detectCustomPatterns(
      text,
      GOVERNMENT_PII_PATTERNS,
      "custom_government"
    );
    const addressEntities = detectCustomPatterns(
      text,
      ADDRESS_PII_PATTERNS,
      "custom_government"
    );
    const nameEntities = detectCustomPatterns(
      text,
      NAME_PATTERNS,
      "compromise"
    );

    allEntities.push(
      ...medicalEntities,
      ...financeEntities,
      ...governmentEntities,
      ...addressEntities,
      ...nameEntities
    );

    // Add custom entity types to our set
    [
      ...medicalEntities,
      ...financeEntities,
      ...governmentEntities,
      ...addressEntities,
      ...nameEntities,
    ].forEach((entity) => piiTypesSet.add(entity.type));

    // 2. Run compromise.js detection for additional entities
    const compromiseEntities = detectCompromiseEntities(text);
    allEntities.push(...compromiseEntities);
    compromiseEntities.forEach((entity) => piiTypesSet.add(entity.type));

    // 3. Try presidio PII detection (with better error handling)
    try {
      const guard = getPresidioGuard();
      const messages = [{ role: "user", content: text }];
      const presidioResults = await guard(messages);

      if (presidioResults && presidioResults.length > 0) {
        const presidioEntities = extractPresidioEntities(text, presidioResults);
        allEntities.push(...presidioEntities);
        presidioEntities.forEach((entity) => piiTypesSet.add(entity.type));
      }
    } catch (presidioError) {
      // Log presidio error but don't fail the entire detection
      console.warn(
        "Presidio detection failed, continuing with other methods:",
        presidioError
      );
    }

    // Remove duplicate entities (same position and type)
    const uniqueEntities = allEntities.filter((entity, index, arr) => {
      return !arr
        .slice(0, index)
        .some(
          (prevEntity) =>
            prevEntity.start === entity.start &&
            prevEntity.end === entity.end &&
            prevEntity.type === entity.type
        );
    });

    const piiTypes = Array.from(piiTypesSet).sort();
    const piiDetected = piiTypes.length > 0;
    const riskLevel = calculatePiiRiskLevel(piiTypes);

    return {
      piiDetected,
      piiTypes,
      riskLevel,
      entities: uniqueEntities.sort((a, b) => a.start - b.start), // Sort by position
    };
  } catch (error) {
    // Log error but don't throw - we don't want PII detection failures to break the main flow
    console.error("PII detection failed:", error);
    return {
      piiDetected: false,
      piiTypes: [],
      riskLevel: "low",
      entities: [],
    };
  }
}

// Utility function to analyze both prompt and response
export async function analyzePiiInPromptResponse(
  prompt: string,
  response: string
): Promise<{
  prompt: PiiDetectionResult;
  response: PiiDetectionResult;
  overallPiiDetected: boolean;
  allPiiTypes: string[];
}> {
  const [promptPii, responsePii] = await Promise.all([
    detectPii(prompt),
    detectPii(response),
  ]);

  const allPiiTypesSet = new Set([
    ...promptPii.piiTypes,
    ...responsePii.piiTypes,
  ]);

  return {
    prompt: promptPii,
    response: responsePii,
    overallPiiDetected: promptPii.piiDetected || responsePii.piiDetected,
    allPiiTypes: Array.from(allPiiTypesSet).sort(),
  };
}
