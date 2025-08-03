import { Recognizer, Entity, OffsetMap } from "../../types";
import nlp from "compromise";

// Helper function to find text positions more accurately
function findTextPositions(
  text: string,
  searchText: string
): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = [];
  let index = 0;

  while (index < text.length) {
    const foundIndex = text.indexOf(searchText, index);
    if (foundIndex === -1) break;

    positions.push({
      start: foundIndex,
      end: foundIndex + searchText.length,
    });
    index = foundIndex + 1;
  }

  return positions;
}

export const compromiseRecognizer: Recognizer = {
  id: "compromise",
  detect(text: string, map: OffsetMap): Entity[] {
    const entities: Entity[] = [];
    const doc = nlp(text);

    // Extract people names (compromise.js is better at distinguishing real names)
    const people = doc.people().json();
    for (const person of people) {
      // Additional validation: ensure these are actually person names, not just capitalized words
      const personDoc = nlp(person.text);

      // Skip if it's clearly not a person (e.g., verbs, adjectives, common nouns)
      if (
        personDoc.has("#Verb") ||
        personDoc.has("#Adjective") ||
        personDoc.has("#Adverb")
      ) {
        continue;
      }

      // Skip medical/emergency instruction terms
      const isInstructionalTerm =
        personDoc.has("#Imperative") ||
        /^(emergency|health|monitor|symptoms|seek|call|avoid|inform|positioning|stay|sit)$/i.test(
          person.text.trim()
        );

      if (isInstructionalTerm) continue;

      const positions = findTextPositions(text, person.text);
      for (const pos of positions) {
        entities.push({
          type: person.text.includes(" ") ? "FULL_NAME" : "FIRST_NAME",
          start: map.origPos(pos.start),
          end: map.origPos(pos.end),
          text: person.text,
          confidence: 0.85, // High confidence from compromise.js people detection
          source: this.id,
          risk: "sensitive" as const,
        });
      }
    }

    // Extract organizations (but be more selective)
    const organizations = doc.organizations().json();
    for (const org of organizations) {
      // Skip obvious non-organizations (geographic references, acronyms in parentheses)
      if (
        /^\([^)]*\)$/.test(org.text) || // Skip text in parentheses like "(e.g., 911 in the U.S.)"
        /^(U\.S\.|UK|USA|Canada|Europe)[\)\.]?$/i.test(org.text.trim())
      ) {
        continue;
      }

      const positions = findTextPositions(text, org.text);
      for (const pos of positions) {
        entities.push({
          type: "FULL_NAME", // We'll mark these differently with source
          start: map.origPos(pos.start),
          end: map.origPos(pos.end),
          text: org.text,
          confidence: 0.75,
          source: "compromise-org", // Different source to identify as business
          risk: "sensitive" as const,
        });
      }
    }

    return entities;
  },
};

// Helper function to check if a word should NOT be considered a name
// This can be used by other recognizers to filter out false positives
export function isLikelyNotAName(text: string, fullContext: string): boolean {
  try {
    const doc = nlp(fullContext);

    // Find the word in context
    const wordInContext = doc.match(text);
    if (!wordInContext.found) return false;

    // Enhanced linguistic checks using compromise.js

    // Check basic parts of speech that are definitely not names
    if (wordInContext.has("#Verb")) return true;
    if (wordInContext.has("#Adjective")) return true;
    if (wordInContext.has("#Adverb")) return true;
    if (wordInContext.has("#Preposition")) return true;
    if (wordInContext.has("#Conjunction")) return true;
    if (wordInContext.has("#Determiner")) return true;
    if (wordInContext.has("#Modal")) return true;
    if (wordInContext.has("#Auxiliary")) return true;

    // Check for imperative verbs (commands/instructions)
    if (wordInContext.has("#Imperative")) return true;

    // Check for common nouns (vs proper nouns which might be names)
    if (wordInContext.has("#CommonNoun")) return true;

    // Check for gerunds (verb forms ending in -ing used as nouns)
    if (wordInContext.has("#Gerund")) return true;

    // Check for medical/technical terminology patterns
    const medicalTerms =
      /^(emergency|health|medical|symptoms|monitor|treatment|therapy|diagnosis|prescription|medication|hospital|clinic|doctor|patient|procedure|surgery|examination|consultation|ambulance|paramedic|nurse|vital|condition|disease|illness|infection|virus|bacteria|fever|pain|breathing|respiratory|cardiac|blood|pressure|heart|lung|brain|liver|kidney|diabetes|cancer|stroke|seizure|allergy|injection|vaccine|test|scan|xray|mri|ultrasound|laboratory|specimen|sample|result|report|chart|record)$/i;

    if (medicalTerms.test(text.trim())) return true;

    // Check for instructional/procedural terms
    const instructionalTerms =
      /^(seek|call|avoid|inform|position|stay|sit|take|give|provide|contact|reach|report|listen|watch|observe|check|verify|confirm|ensure|prevent|reduce|increase|decrease|improve|maintain|continue|stop|start|begin|end|finish|complete|follow|perform|execute|implement|apply|use|utilize|operate|handle|manage|control|direct|guide|assist|help|support|advise|recommend|suggest|indicate|show|demonstrate|explain|describe|discuss|review|examine|evaluate|assess|analyze|consider|determine|decide|choose|select|prefer|require|need|want|wish|hope|expect|anticipate|prepare|plan|organize|arrange|schedule|coordinate|communicate|inform|notify|alert|warn|remind|update|progress|develop|create|establish|build|construct)$/i;

    if (instructionalTerms.test(text.trim())) return true;

    // Check for section headers/bullet point terms (often capitalized but not names)
    const contextAroundWord = fullContext.substring(
      Math.max(0, fullContext.indexOf(text) - 20),
      fullContext.indexOf(text) + text.length + 20
    );

    // If word appears after bullet points, numbers, or in headers, likely not a name
    if (
      /[0-9]+\.\s*\*?\*?/.test(contextAroundWord) ||
      /#{1,6}\s/.test(contextAroundWord) ||
      /\*\*.*\*\*/.test(contextAroundWord)
    ) {
      return true;
    }

    // Check the actual tags from compromise.js for more granular analysis
    const docData = wordInContext.json();
    if (docData && docData.length > 0 && docData[0].terms) {
      const tags = docData[0].terms[0].tags || [];
      const nonNameTags = [
        "Verb",
        "Adjective",
        "Adverb",
        "Preposition",
        "Conjunction",
        "Determiner",
        "Modal",
        "Auxiliary",
        "Imperative",
        "CommonNoun",
        "Gerund",
        "Infinitive",
        "PastTense",
        "PresentTense",
        "FutureTense",
        "Comparative",
        "Superlative",
        "Possessive",
        "Plural",
      ];
      return tags.some((tag: string) => nonNameTags.includes(tag));
    }

    return false;
  } catch (error) {
    // If compromise.js fails, don't filter the word
    console.warn("Error in isLikelyNotAName:", error);
    return false;
  }
}
