import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { TracePromptInit } from "./types";

process.env.AWS_PROFILE = "traceprompt-ingest-role";

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
  private _cfg?: Required<TracePromptInit>;

  load(userCfg: Partial<TracePromptInit> = {}): void {
    if (this._cfg) return;

    const fileCfg = process.env["TRACEPROMPT_RC"]
      ? readYaml(process.env["TRACEPROMPT_RC"])
      : {};

    const envCfg: Partial<TracePromptInit> = {
      ...(process.env["TRACEPROMPT_TENANT_ID"] && {
        tenantId: process.env["TRACEPROMPT_TENANT_ID"],
      }),
      ...(process.env["TRACEPROMPT_API_KEY"] && {
        apiKey: process.env["TRACEPROMPT_API_KEY"],
      }),
      ...(process.env["TRACEPROMPT_CMK_ARN"] && {
        cmkArn: process.env["TRACEPROMPT_CMK_ARN"],
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
      tenantId: "",
      apiKey: "",
      cmkArn: "",
      ingestUrl: "",
      batchSize: 25,
      flushIntervalMs: 2_000,
      staticMeta: {},
      logLevel: "verbose",
      ...fileCfg,
      ...envCfg,
      ...userCfg,
    };

    if (!merged.tenantId) throw new Error("Traceprompt: tenantId is required");
    if (!merged.apiKey) throw new Error("Traceprompt: apiKey is required");
    if (!merged.cmkArn) throw new Error("Traceprompt: cmkArn is required");
    if (!merged.ingestUrl)
      throw new Error("Traceprompt: ingestUrl is required");
    if (merged.batchSize! <= 0) merged.batchSize = 25;
    if (merged.flushIntervalMs! <= 0) merged.flushIntervalMs = 2_000;

    this._cfg = merged as Required<TracePromptInit>;
  }

  get cfg(): Readonly<Required<TracePromptInit>> {
    if (!this._cfg) {
      throw new Error("Traceprompt: initTracePrompt() must be called first");
    }
    return this._cfg;
  }
}

export function initTracePrompt(cfg?: Partial<TracePromptInit>): void {
  ConfigManager.load(cfg);
}

export const ConfigManager = new ConfigManagerClass();
