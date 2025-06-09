import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { TracePromptInit } from "./types";

// Internal interface that includes the resolved orgId
interface InternalTracePromptConfig extends TracePromptInit {
  orgId: string; // Always present after resolution
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

process.env.AWS_PROFILE = "traceprompt-ingest-role";

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
      throw new Error(
        `Failed to resolve organization: ${response.status} ${response.statusText}`
      );
    }

    const result: WhoAmIResponse = await response.json();

    if (!result.success) {
      throw new Error("Failed to resolve organization from API key");
    }

    const orgId = result.data.orgId;
    if (!orgId) {
      throw new Error("No organization ID found in API key response");
    }

    const cmkArn = result.data.kmsKeyArn;

    console.log(`✓ Traceprompt auto-resolved organization: ${orgId}`);

    return { orgId, cmkArn };
  } catch (error) {
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
      cmkArn: "",
      ingestUrl: "http://localhost:3000/v1/ingest", // Default for local development
      batchSize: 25,
      flushIntervalMs: 2_000,
      staticMeta: {},
      logLevel: "verbose",
      ...fileCfg,
      ...envCfg,
      ...userCfg,
    };

    // Validate required fields
    if (!merged.apiKey) throw new Error("Traceprompt: apiKey is required");

    // Auto-resolve orgId and cmkArn from API key
    let orgId: string;
    let cmkArn: string;

    try {
      const resolved = await resolveOrgFromApiKey(
        merged.apiKey,
        merged.ingestUrl
      );
      orgId = resolved.orgId;
      cmkArn = resolved.cmkArn!;
    } catch (error) {
      throw new Error(
        `Failed to auto-resolve organization: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Final validation
    if (merged.batchSize! <= 0) merged.batchSize = 25;
    if (merged.flushIntervalMs! <= 0) merged.flushIntervalMs = 2_000;

    // Create internal config with resolved orgId
    this._cfg = {
      ...merged,
      orgId,
      cmkArn,
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
