import fs from "fs";
import yaml from "yaml";
import { TracePromptInit } from "./types";

class ConfigManagerClass {
  private _cfg!: Required<TracePromptInit>;

  load(userCfg?: Partial<TracePromptInit>) {
    if (
      !process.env.TRACEPROMPT_TENANT_ID ||
      !process.env.TP_CMK_ARN ||
      !process.env.TRACEPROMPT_INGEST_URL
    ) {
      throw new Error(
        "TRACEPROMPT_TENANT_ID, TP_CMK_ARN, and TRACEPROMPT_INGEST_URL environment variables are required"
      );
    }

    const file = process.env.TRACEPROMPT_RC ?? "./.tracepromptrc.yml";
    const fileCfg = fs.existsSync(file)
      ? yaml.parse(fs.readFileSync(file, "utf8"))
      : {};
    const envCfg = {
      tenantId: process.env.TRACEPROMPT_TENANT_ID,
      cmkArn: process.env.TP_CMK_ARN,
      ingestUrl: process.env.TRACEPROMPT_INGEST_URL,
    };
    this._cfg = {
      batchSize: 25,
      flushIntervalMs: 2000,
      staticMeta: {},
      ...fileCfg,
      ...envCfg,
      ...userCfg,
    } as Required<TracePromptInit>;
  }

  get cfg() {
    return this._cfg;
  }
}

export const ConfigManager = new ConfigManagerClass();
