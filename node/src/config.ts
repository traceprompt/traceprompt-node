/**
 * config.ts
 * ------------------------------------------------------
 * Centralised configuration loader for the TracePrompt SDK.
 *
 * Precedence (highest → lowest):
 *   1. Runtime override object passed to initTracePrompt().
 *   2. Environment variables:
 *        TRACEPROMPT_TENANT_ID
 *        TRACEPROMPT_API_KEY
 *        TP_CMK_ARN
 *        TRACEPROMPT_INGEST_URL
 *        TRACEPROMPT_BATCH_SIZE
 *        TRACEPROMPT_FLUSH_INTERVAL_MS
 *   3. YAML file (path in $TRACEPROMPT_RC or default '.tracepromptrc.yml').
 *
 * The resolved config is cached for fast access by other modules.
 * ------------------------------------------------------
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { TracePromptInit } from "./types";

/* ---------- Internal helper ---------- */
function readYaml(filePath: string): Partial<TracePromptInit> {
  try {
    let abs: string;

    // If it's an absolute path or contains path separators, use as-is
    if (path.isAbsolute(filePath) || filePath.includes(path.sep)) {
      abs = path.resolve(process.cwd(), filePath);
    }
    // For the default filename, try current directory first, then fallback to packages/node
    else if (filePath === ".tracepromptrc.yml") {
      const cwdPath = path.resolve(process.cwd(), filePath);
      if (fs.existsSync(cwdPath)) {
        abs = cwdPath;
      } else {
        // Fallback to packages/node directory
        abs = path.resolve(__dirname, "..", filePath);
      }
    }
    // Other relative paths resolve from current directory
    else {
      abs = path.resolve(process.cwd(), filePath);
    }

    if (!fs.existsSync(abs)) return {};
    const raw = fs.readFileSync(abs, "utf8");
    return yaml.parse(raw) ?? {};
  } catch {
    return {};
  }
}

/* ---------- Config manager singleton ---------- */
class ConfigManagerClass {
  private _cfg?: Required<TracePromptInit>;

  /** Load or reload configuration (called once from initTracePrompt). */
  load(userCfg: Partial<TracePromptInit> = {}): void {
    if (this._cfg) return; // already loaded

    /* 1. YAML file ------------------------------------------------- */
    const rcPath = process.env["TRACEPROMPT_RC"] ?? ".tracepromptrc.yml";
    const fileCfg = readYaml(rcPath);

    /* 2. Environment ---------------------------------------------- */
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
    };

    /* 3. Merge with defaults -------------------------------------- */
    const merged: TracePromptInit = {
      tenantId: "",
      apiKey: "",
      cmkArn: "",
      ingestUrl: "",
      batchSize: 25,
      flushIntervalMs: 2_000,
      staticMeta: {},
      ...fileCfg,
      ...envCfg,
      ...userCfg,
    };

    /* 4. Basic validation ----------------------------------------- */
    if (!merged.tenantId) throw new Error("TracePrompt: tenantId is required");
    if (!merged.apiKey) throw new Error("TracePrompt: apiKey is required");
    if (!merged.cmkArn) throw new Error("TracePrompt: cmkArn is required");
    if (!merged.ingestUrl)
      throw new Error("TracePrompt: ingestUrl is required");
    if (merged.batchSize! <= 0) merged.batchSize = 25;
    if (merged.flushIntervalMs! <= 0) merged.flushIntervalMs = 2_000;

    this._cfg = merged as Required<TracePromptInit>;
  }

  /** Access the resolved configuration. */
  get cfg(): Readonly<Required<TracePromptInit>> {
    if (!this._cfg) {
      throw new Error("TracePrompt: initTracePrompt() must be called first");
    }
    return this._cfg;
  }
}

export function initTracePrompt(cfg?: Partial<TracePromptInit>): void {
  ConfigManager.load(cfg);
}

export const ConfigManager = new ConfigManagerClass();
