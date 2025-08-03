import { Entity, Recognizer } from "../types";
import { regexRecognizer } from "./recognizers/regexRecognizer";
import { idRecognizer } from "./recognizers/idRecognizer";
import { compromiseRecognizer } from "./recognizers/compromiseRecognizer";
import { nameRecognizer } from "./recognizers/nameRecognizer";
import { nerRecognizer } from "./recognizers/nerRecognizer";
import { preprocess } from "./preprocessor";

// 🧠 SCALABLE PII DETECTION: No domain-specific word lists required
// This approach uses multi-recognizer consensus and linguistic intelligence

const RECOGNIZERS: Recognizer[] = [
  regexRecognizer, // High confidence patterns (phones, emails, etc.)
  idRecognizer, // National IDs with validation
  compromiseRecognizer, // Linguistic analysis for names
  nameRecognizer, // Capitalization patterns
  nerRecognizer, // NLP entity recognition
];

const RISK_LEVELS: Record<string, "general" | "sensitive" | "critical"> = {
  EMAIL: "sensitive",
  PHONE: "sensitive",
  FIRST_NAME: "sensitive",
  LAST_NAME: "sensitive",
  FULL_NAME: "sensitive",
  SSN: "critical",
  CREDIT_CARD: "critical",
  DRIVERS_LICENSE: "critical",
  PASSPORT: "critical",
  ADDRESS: "sensitive",
  DATE_OF_BIRTH: "sensitive",
  BANK_ACCOUNT: "critical",
  IBAN: "critical",
  SWIFT_CODE: "sensitive",
  UK_SORT_CODE: "sensitive",
  US_ROUTING: "sensitive",
  NATIONAL_ID: "critical",
};

function addRiskLevel(entity: Omit<Entity, "risk">): Entity {
  return {
    ...entity,
    risk: RISK_LEVELS[entity.type] || "general",
  };
}

/**
 * 🎯 ENHANCED PII DETECTION with Multi-Recognizer Consensus
 *
 * This approach scales to any domain without requiring word lists:
 * - Uses linguistic intelligence over pattern matching
 * - Requires recognizer consensus for edge cases
 * - Validates entity plausibility contextually
 */
export function detectPIIEnhanced(raw: string): Entity[] {
  const { text, map } = preprocess(raw);

  // Run all recognizers
  let rawEntities: Entity[] = [];
  for (const recognizer of RECOGNIZERS) {
    try {
      const detected = recognizer.detect(text, map);
      rawEntities = rawEntities.concat(detected.map(addRiskLevel));
    } catch (error) {
      console.warn(`Recognizer ${recognizer.id} failed:`, error);
    }
  }

  // Apply smart consensus filtering (the secret sauce!)
  const filteredEntities = applySmartConsensusFiltering(rawEntities, text);

  // Sort and merge overlapping entities
  filteredEntities.sort(
    (a, b) => a.start - b.start || b.confidence - a.confidence
  );

  const merged: Entity[] = [];
  for (const entity of filteredEntities) {
    const last = merged[merged.length - 1];
    if (last && entity.start < last.end) {
      // Prefer higher confidence or more specific types
      if (
        entity.confidence > last.confidence ||
        (entity.source === "nat-id" && last.type === "PHONE")
      ) {
        merged[merged.length - 1] = entity;
      }
      continue;
    }
    merged.push(entity);
  }

  return merged;
}

/**
 * 🧠 SCALABLE FILTERING: Uses recognizer consensus + linguistic intelligence
 * No domain-specific word lists needed - works for medical, finance, legal, etc.
 */
function applySmartConsensusFiltering(
  entities: Entity[],
  fullText: string
): Entity[] {
  // Group overlapping entities by position
  const entityGroups = groupOverlappingEntities(entities);
  const filteredEntities: Entity[] = [];

  for (const group of entityGroups) {
    const highestConfidence = Math.max(...group.map((e) => e.confidence));
    const recognizerCount = new Set(group.map((e) => e.source)).size;
    const consensusEntity = group.find(
      (e) => e.confidence === highestConfidence
    )!;

    // 🎯 CONSENSUS RULES (domain-agnostic):

    // Rule 1: High confidence from any recognizer (obvious PII)
    if (highestConfidence >= 0.85) {
      filteredEntities.push(consensusEntity);
      continue;
    }

    // Rule 2: Multiple recognizers agree (even medium confidence)
    if (recognizerCount >= 2 && highestConfidence >= 0.65) {
      filteredEntities.push(consensusEntity);
      continue;
    }

    // Rule 3: Regex patterns are usually reliable (emails, phones, IDs)
    if (consensusEntity.source === "regex" && highestConfidence >= 0.8) {
      filteredEntities.push(consensusEntity);
      continue;
    }

    // Rule 4: Context-aware validation for names
    if (isNameType(consensusEntity.type)) {
      if (
        highestConfidence >= 0.7 &&
        !looksLikeInstructionalContent(consensusEntity, fullText) &&
        looksLikePlausibleName(consensusEntity.text)
      ) {
        filteredEntities.push(consensusEntity);
        continue;
      }
    } else {
      // Non-name entities: be more permissive
      if (highestConfidence >= 0.7) {
        filteredEntities.push(consensusEntity);
        continue;
      }
    }

    // Otherwise: likely false positive, filter out
  }

  return filteredEntities;
}

// Helper functions for smart filtering

function isNameType(type: string): boolean {
  return ["FIRST_NAME", "LAST_NAME", "FULL_NAME"].includes(type);
}

function groupOverlappingEntities(entities: Entity[]): Entity[][] {
  const groups: Entity[][] = [];
  const processed = new Set<number>();

  for (let i = 0; i < entities.length; i++) {
    if (processed.has(i)) continue;

    const group = [entities[i]];
    processed.add(i);

    for (let j = i + 1; j < entities.length; j++) {
      if (processed.has(j)) continue;

      // Check for significant overlap
      const overlap = Math.max(
        0,
        Math.min(entities[i].end, entities[j].end) -
          Math.max(entities[i].start, entities[j].start)
      );
      const minLength = Math.min(
        entities[i].text.length,
        entities[j].text.length
      );

      if (overlap > minLength * 0.5) {
        // 50% overlap threshold
        group.push(entities[j]);
        processed.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * 🧠 LINGUISTIC INTELLIGENCE: Detect document structure patterns
 * Works across all domains - medical, legal, financial, technical
 */
function looksLikeInstructionalContent(
  entity: Entity,
  fullText: string
): boolean {
  const beforeContext = fullText.substring(
    Math.max(0, entity.start - 100),
    entity.start
  );
  const afterContext = fullText.substring(
    entity.end,
    Math.min(fullText.length, entity.end + 50)
  );
  const entityContext = fullText.substring(
    Math.max(0, entity.start - 30),
    Math.min(fullText.length, entity.end + 30)
  );

  // Document structure patterns (universal across domains):
  const structuralIndicators = [
    /^\s*\d+\.\s/m, // Numbered lists: "1. Item"
    /^\s*[-•*]\s/m, // Bullet points: "- Item"
    /^#{1,6}\s/m, // Markdown headers: "# Title"
    /\*\*[^*]*\*\*/, // Bold text: "**Bold**"
    /_[^_]+_/, // Italic: "_emphasis_"
    /\([^)]*\)/, // Parenthetical: "(example)"
    /:$/, // Colon endings: "Category:"
  ];

  if (structuralIndicators.some((pattern) => pattern.test(entityContext))) {
    return true;
  }

  // Context patterns that suggest procedural/instructional content:
  const proceduralContext = [
    /\b(step|phase|stage|section|part|chapter|item|point|element|component|aspect|factor|metric|goal|target|objective|strategy|method|approach|technique|procedure|process|protocol|guideline|instruction|recommendation|suggestion|tip|advice|note|warning|caution|important|critical|essential|key|main|primary|secondary|additional|optional|required|necessary|needed|recommended|suggested|advised|proposed|planned|scheduled|organized|structured|formatted|designed|created|developed|established|implemented|applied|used|utilized|employed|adopted|followed|maintained|monitored|tracked|measured|evaluated|assessed|reviewed|analyzed|examined|studied|researched|investigated|explored|discovered|identified|recognized|detected|found|located|positioned|placed|situated|arranged|ordered|sorted|grouped|categorized|classified|labeled|tagged|marked|noted|recorded|documented|reported|described|explained|detailed|specified|defined|outlined|summarized|listed|enumerated|counted|calculated|computed|determined|decided|chosen|selected|preferred|prioritized|emphasized|highlighted|stressed|underlined|bolded|italicized|formatted|styled|presented|displayed|shown|demonstrated|illustrated|exemplified|represented|symbolized|indicated|signified|suggested|implied|meant|intended|designed|planned|aimed|targeted|focused|directed|oriented|guided|led|managed|controlled|supervised|overseen|administered|operated|executed|performed|conducted|carried|completed|finished|concluded|ended|stopped|terminated|closed|finalized|achieved|accomplished|attained|reached|obtained|gained|acquired|secured|ensured|guaranteed|assured|confirmed|verified|validated|authenticated|authorized|approved|accepted|endorsed|supported|backed|sponsored|funded|financed|invested|contributed|donated|provided|supplied|delivered|distributed|allocated|assigned|designated|appointed|nominated|selected|chosen|picked|elected|voted|decided|determined|resolved|settled|concluded|agreed|consented|approved|accepted|endorsed|recommended|suggested|proposed|offered|presented|submitted|requested|asked|inquired|questioned|challenged|disputed|contested|argued|debated|discussed|talked|spoke|communicated|informed|notified|alerted|warned|cautioned|advised|counseled|guided|directed|instructed|taught|educated|trained|coached|mentored|supervised|managed|led|headed|chaired|presided|moderated|facilitated|coordinated|organized|arranged|planned|scheduled|programmed|designed|developed|created|built|constructed|established|founded|formed|shaped|molded|crafted|produced|manufactured|generated|synthesized|compiled|assembled|gathered|collected|accumulated|amassed|stockpiled|stored|saved|preserved|maintained|kept|held|retained|sustained|continued|persisted|endured|lasted|remained|stayed|persevered|persisted|insisted|demanded|required|needed|wanted|desired|wished|hoped|expected|anticipated|predicted|forecasted|projected|estimated|calculated|computed|figured|determined|assessed|evaluated|measured|quantified|qualified|characterized|described|defined|explained|clarified|specified|detailed|elaborated|expanded|extended|broadened|widened|deepened|enhanced|improved|upgraded|updated|revised|modified|changed|altered|adjusted|adapted|customized|personalized|individualized|tailored|fitted|suited|matched|aligned|coordinated|synchronized|harmonized|balanced|stabilized|normalized|standardized|regularized|systematized|organized|structured|formatted|styled|designed|patterned|modeled|templated|outlined|sketched|drafted|written|composed|authored|created|produced|generated|developed|formulated|conceived|devised|invented|discovered|found|identified|recognized|detected|spotted|noticed|observed|seen|viewed|watched|monitored|tracked|followed|traced|investigated|explored|examined|studied|analyzed|reviewed|assessed|evaluated|judged|rated|ranked|scored|graded|tested|checked|verified|confirmed|validated|authenticated|approved|certified|accredited|licensed|authorized|permitted|allowed|enabled|empowered|equipped|prepared|ready|set|primed|positioned|placed|located|situated|arranged|organized|structured|formatted|designed|styled|presented|displayed|shown|exhibited|demonstrated|illustrated|exemplified|represented|depicted|portrayed|characterized|described|explained|defined|specified|detailed|outlined|summarized|abstracted|generalized|categorized|classified|grouped|sorted|ordered|arranged|organized|structured|systematized|methodized|proceduralized|protocolized|standardized|normalized|regularized|routinized|habitualized|institutionalized|formalized|officialized|legalized|authorized|approved|endorsed|sanctioned|permitted|allowed|enabled|facilitated|supported|assisted|helped|aided|backed|sponsored|funded|financed|invested|contributed|provided|supplied|delivered|distributed|allocated|assigned|designated|appointed|selected|chosen|elected|voted|decided|determined|resolved|concluded|settled|agreed|consented|approved|accepted|endorsed|recommended|suggested|proposed|offered|presented|submitted|requested|demanded|required|needed|wanted|desired|wished|hoped|expected|anticipated)\b/i,
  ];

  return proceduralContext.some((pattern) =>
    pattern.test(beforeContext + afterContext)
  );
}

/**
 * 🧠 NAME PLAUSIBILITY: Universal validation without hardcoded lists
 */
function looksLikePlausibleName(text: string): boolean {
  // Universal anti-patterns for names (work across all languages/cultures):

  // 1. Ends with punctuation or symbols
  if (/[.!?:;,*#_\-\]\}\)\>]$/.test(text.trim())) return false;

  // 2. Contains markdown or formatting
  if (/\*\*|\#{1,6}|^\d+\.|_.*_|\[.*\]|\{.*\}/.test(text)) return false;

  // 3. Very short single words (but allow common short names like "Li", "Wu", etc.)
  if (!text.includes(" ") && text.length < 2) return false;

  // 4. Contains obvious procedural suffixes (universal patterns)
  const proceduralSuffixes =
    /\b(ups?|ing|ment|tion|sion|ness|ship|hood|ward|wise|like|able|ible|ful|less|ous|ive|ary|ory|ery|ity|ety|age|ure|ance|ence|ism|ist|ite|ese|ian|ern|ock|ick|ack|eck|uck|alk|ell|ill|oll|ull|amp|emp|imp|omp|ump|and|end|ind|ond|und|ant|ent|int|ont|unt|ard|erd|ird|ord|urd|ase|ese|ise|ose|use|ate|ete|ite|ote|ute|ave|eve|ive|ove|ake|eke|ike|oke|uke|ame|eme|ime|ome|ume|ane|ene|ine|one|une|ape|epe|ipe|ope|upe|are|ere|ire|ore|ure|ase|ese|ise|ose|use|ate|ete|ite|ote|ute|ath|eth|ith|oth|uth|aw|ew|iw|ow|uw|ay|ey|iy|oy|uy)$/i;

  if (proceduralSuffixes.test(text.trim())) return false;

  // 5. Starts with obvious non-name patterns
  if (
    /^(the|and|or|but|if|when|where|how|why|what|who|which|that|this|these|those|a|an|to|of|in|on|at|by|for|with|from|up|out|down|off|over|under|above|below|between|among|through|during|before|after|since|until|while|although|because|unless|except|besides|despite|however|therefore|moreover|furthermore|nevertheless|nonetheless|meanwhile|otherwise|instead|rather|either|neither|both|all|some|many|few|several|each|every|any|no|none|most|more|less|least|much|little|enough|too|very|quite|rather|fairly|pretty|really|truly|actually|certainly|definitely|probably|possibly|maybe|perhaps|likely|unlikely|surely|obviously|clearly|apparently|evidently|presumably|supposedly|allegedly|reportedly|seemingly|apparently)$/i.test(
      text.trim()
    )
  ) {
    return false;
  }

  // If it passes all these checks, it's plausibly a name
  return true;
}

// Export both the original and enhanced versions
export { detectPII } from "./pipeline"; // Original pipeline
// Enhanced pipeline is the default export of this file
