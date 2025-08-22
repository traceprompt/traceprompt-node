import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { TracePromptInit } from "./types";

interface InternalTracePromptConfig extends TracePromptInit {
  orgId: string; // Always present after resolution
  cmkArn: string; // KMS key ARN for encryption
  hmacSecret: string; // HMAC secret for signing requests
}

interface WhoAmIResponse {
  success: boolean;
  data: {
    type: "organization";
    orgId?: string;
    orgName?: string;
    kmsKeyArn?: string;
    scope: string;
    keyId: string;
  };
}

interface HmacSecretResponse {
  success: boolean;
  data: {
    hmacSecret: string;
    keyId: string;
  };
}

interface ErrorResponse {
  error?: string;
  message?: string;
  reason?: string;
  subscriptionStatus?: string;
}

/**
 * Fetch HMAC secret from API key
 */
async function fetchHmacSecret(
  apiKey: string,
  ingestUrl: string
): Promise<string> {
  try {
    const hmacUrl = `${ingestUrl.replace("/v1/ingest", "")}/v1/hmac-secret`;

    const response = await fetch(hmacUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;

      try {
        const errorBody = (await response.json()) as ErrorResponse;
        if (errorBody.message) {
          errorMessage = errorBody.message;
        } else if (errorBody.error) {
          errorMessage = errorBody.error;
        }
      } catch {
        // If we can't parse the error response, use the default message
      }

      throw new Error(errorMessage);
    }

    const result = (await response.json()) as HmacSecretResponse;

    if (!result.success || !result.data?.hmacSecret) {
      throw new Error("Invalid HMAC secret response");
    }

    return result.data.hmacSecret;
  } catch (error: any) {
    // If it's already a formatted error message, don't wrap it again
    if (
      error.message &&
      !error.message.startsWith("Failed to fetch HMAC secret:")
    ) {
      throw error;
    }
    throw new Error(`Failed to fetch HMAC secret: ${error.message}`);
  }
}

/**
 * Auto-resolve organization info from API key
 * This is handled internally - users don't need to specify any IDs
 */
async function resolveOrgFromApiKey(
  apiKey: string,
  ingestUrl: string
): Promise<{ orgId: string; cmkArn?: string }> {
  try {
    const whoamiUrl = `${ingestUrl.replace("/v1/ingest", "")}/v1/whoami`;

    const response = await fetch(whoamiUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;

      try {
        const errorBody = (await response.json()) as ErrorResponse;
        if (errorBody.message) {
          errorMessage = errorBody.message;
        } else if (errorBody.error) {
          errorMessage = errorBody.error;
        }
      } catch {
        // If we can't parse the error response, use the default message
      }

      throw new Error(`Failed to resolve organization: ${errorMessage}`);
    }

    const result = (await response.json()) as WhoAmIResponse;

    if (!result.success) {
      throw new Error("Failed to resolve organization from API key");
    }

    const orgId = result.data.orgId;
    if (!orgId) {
      throw new Error("No organization ID found in API key response");
    }

    const cmkArn = result.data.kmsKeyArn;

    return { orgId, cmkArn };
  } catch (error) {
    // If the error already has a descriptive message about organization resolution, pass it through
    if (
      error instanceof Error &&
      error.message.includes("Failed to resolve organization")
    ) {
      throw error;
    }
    throw new Error(
      `Failed to auto-resolve organization from API key: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function readYaml(filePath: string): Partial<TracePromptInit> {
  try {
    const abs = path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(abs)) return {};
    const raw = fs.readFileSync(abs, "utf8");
    return yaml.parse(raw) ?? {};
  } catch {
    return {};
  }
}

class ConfigManagerClass {
  private _cfg?: Required<InternalTracePromptConfig>;
  private _loadPromise?: Promise<void>;

  async load(userCfg: Partial<TracePromptInit> = {}): Promise<void> {
    if (this._cfg) return;

    // Prevent multiple concurrent loads
    if (this._loadPromise) {
      await this._loadPromise;
      return;
    }

    this._loadPromise = this._doLoad(userCfg);
    await this._loadPromise;
  }

  private async _doLoad(userCfg: Partial<TracePromptInit> = {}): Promise<void> {
    const fileCfg = process.env["TRACEPROMPT_RC"]
      ? readYaml(process.env["TRACEPROMPT_RC"])
      : {};

    const envCfg: Partial<TracePromptInit> = {
      ...(process.env["TRACEPROMPT_API_KEY"] && {
        apiKey: process.env["TRACEPROMPT_API_KEY"],
      }),
      ...(process.env["TRACEPROMPT_INGEST_URL"] && {
        ingestUrl: process.env["TRACEPROMPT_INGEST_URL"],
      }),
      ...(process.env["TRACEPROMPT_BATCH_SIZE"] && {
        batchSize: Number(process.env["TRACEPROMPT_BATCH_SIZE"]),
      }),
      ...(process.env["TRACEPROMPT_FLUSH_INTERVAL_MS"] && {
        flushIntervalMs: Number(process.env["TRACEPROMPT_FLUSH_INTERVAL_MS"]),
      }),
      ...(process.env["TRACEPROMPT_LOG_LEVEL"] && {
        logLevel: process.env["TRACEPROMPT_LOG_LEVEL"] as any,
      }),
    };

    const merged: TracePromptInit = {
      apiKey: "",
      ingestUrl: "https://api.traceprompt.com/v1/ingest",
      // ingestUrl: "https://api-staging.traceprompt.com/v1/ingest",
      batchSize: 25,
      flushIntervalMs: 2_000,
      staticMeta: {},
      logLevel: "info",
      ...fileCfg,
      ...envCfg,
      ...userCfg,
    };

    // Validate required fields
    if (!merged.apiKey) throw new Error("Traceprompt: apiKey is required");

    // Auto-resolve orgId, cmkArn, and HMAC secret from API key
    let orgId: string;
    let cmkArn: string;
    let hmacSecret: string;

    try {
      const resolved = await resolveOrgFromApiKey(
        merged.apiKey,
        merged.ingestUrl
      );
      orgId = resolved.orgId;
      cmkArn = resolved.cmkArn!;
    } catch (error) {
      // If the error is already about organization resolution, pass it through to avoid repetition
      if (
        error instanceof Error &&
        error.message.includes("Failed to resolve organization")
      ) {
        throw error;
      }
      throw new Error(
        `Failed to resolve organization: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    try {
      // Fetch HMAC secret for signing requests
      hmacSecret = await fetchHmacSecret(merged.apiKey, merged.ingestUrl);
    } catch (error) {
      // Pass through the original error message without wrapping
      throw error;
    }

    // Final validation
    if (merged.batchSize! <= 0) merged.batchSize = 25;
    if (merged.flushIntervalMs! <= 0) merged.flushIntervalMs = 2_000;

    // Create internal config with resolved orgId and HMAC secret
    this._cfg = {
      ...merged,
      orgId,
      cmkArn,
      hmacSecret,
      apiKey: merged.apiKey,
      ingestUrl: merged.ingestUrl,
    } as Required<InternalTracePromptConfig>;
  }

  get cfg(): Readonly<Required<InternalTracePromptConfig>> {
    if (!this._cfg) {
      throw new Error("Traceprompt: initTracePrompt() must be called first");
    }
    return this._cfg;
  }
}

export async function initTracePrompt(
  cfg?: Partial<TracePromptInit>
): Promise<void> {
  await ConfigManager.load(cfg);
}

export const ConfigManager = new ConfigManagerClass();
