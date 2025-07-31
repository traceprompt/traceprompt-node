import { detectPII } from "../piiDetector/pipeline";
import { Entity, EntityType, RiskLevel } from "../types";

// Re-export detectPII as detectPii for backward compatibility
export const detectPii = detectPII;

interface PiiAnalysisResult {
  piiDetected: boolean;
  piiTypes: EntityType[];
  riskLevel: RiskLevel;
}

interface FullPiiAnalysis {
  overallPiiDetected: boolean;
  allPiiTypes: EntityType[];
  prompt: PiiAnalysisResult;
  response: PiiAnalysisResult;
}

// Export type for backward compatibility
export type PiiDetectionResult = FullPiiAnalysis;

function analyzeSingleText(text: string): PiiAnalysisResult {
  const entities = detectPII(text);

  if (entities.length === 0) {
    return {
      piiDetected: false,
      piiTypes: [],
      riskLevel: "general",
    };
  }

  const piiTypes = [...new Set(entities.map((entity) => entity.type))];

  // Determine highest risk level
  let highestRisk: RiskLevel = "general";
  for (const entity of entities) {
    if (entity.risk === "critical") {
      highestRisk = "critical";
      break;
    } else if (entity.risk === "sensitive" && highestRisk === "general") {
      highestRisk = "sensitive";
    }
  }

  return {
    piiDetected: true,
    piiTypes,
    riskLevel: highestRisk,
  };
}

export async function analyzePiiInPromptResponse(
  prompt: string,
  response: string
): Promise<FullPiiAnalysis> {
  const promptAnalysis = analyzeSingleText(prompt);
  const responseAnalysis = analyzeSingleText(response);

  // Combine all PII types from both prompt and response
  const allPiiTypes = [
    ...new Set([...promptAnalysis.piiTypes, ...responseAnalysis.piiTypes]),
  ];

  return {
    overallPiiDetected:
      promptAnalysis.piiDetected || responseAnalysis.piiDetected,
    allPiiTypes,
    prompt: promptAnalysis,
    response: responseAnalysis,
  };
}
