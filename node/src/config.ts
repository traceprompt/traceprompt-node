/**
 * @fileoverview Configuration management for the Traceprompt SDK
 *
 * This module handles loading and validating configuration from multiple sources:
 * - Direct configuration objects passed to `initTracePrompt()`
 * - Environment variables (`TRACEPROMPT_*` and `TP_*` prefixes)
 * - YAML configuration files (when explicitly specified via `TRACEPROMPT_RC`)
 *
 * ## Configuration Precedence (highest to lowest priority)
 *
 * 1. **Direct configuration** - Object passed to `initTracePrompt()`
 * 2. **Environment variables** - `TRACEPROMPT_*` and `TP_*` prefixed variables
 * 3. **YAML config file** - Only when `TRACEPROMPT_RC` environment variable is set
 * 4. **Built-in defaults** - Sensible defaults for optional parameters
 *
 * ## Environment Variables
 *
 * All configuration options can be set via environment variables:
 *
 * | Config Property | Environment Variable | Example |
 * |-----------------|---------------------|---------|
 * | `tenantId` | `TRACEPROMPT_TENANT_ID` | `tnt_abc123` |
 * | `apiKey` | `TRACEPROMPT_API_KEY` | `tp_live_xyz789` |
 * | `cmkArn` | `TRACEPROMPT_CMK_ARN` or `TP_CMK_ARN` | `arn:aws:kms:...` |
 * | `ingestUrl` | `TRACEPROMPT_INGEST_URL` | `https://api.traceprompt.dev` |
 * | `batchSize` | `TRACEPROMPT_BATCH_SIZE` | `25` |
 * | `flushIntervalMs` | `TRACEPROMPT_FLUSH_INTERVAL_MS` | `2000` |
 *
 * ## YAML Configuration File
 *
 * To use a YAML configuration file, set the `TRACEPROMPT_RC` environment variable:
 *
 * ```bash
 * export TRACEPROMPT_RC=/path/to/my-config.yml
 * ```
 *
 * Example YAML file:
 *
 * ```yaml
 * # my-config.yml
 * tenantId: tnt_your_tenant_id
 * apiKey: tp_your_api_key
 * cmkArn: arn:aws:kms:us-east-1:123456789:key/your-key-id
 * ingestUrl: https://api.traceprompt.dev
 *
 * # Optional performance settings
 * batchSize: 25
 * flushIntervalMs: 2000
 *
 * # Static metadata attached to all records
 * staticMeta:
 *   environment: production
 *   application: my-llm-app
 *   version: 1.0.0
 * ```
 *
 * ## Configuration Examples
 *
 * ### Production Setup (Environment Variables)
 * ```bash
 * # .env file or environment
 * TRACEPROMPT_TENANT_ID=tnt_prod_123
 * TRACEPROMPT_API_KEY=tp_live_abc789
 * TRACEPROMPT_CMK_ARN=arn:aws:kms:us-east-1:123456789:key/your-key-id
 * TRACEPROMPT_INGEST_URL=https://api.traceprompt.dev
 * ```
 *
 * ### Development Setup (Direct Configuration)
 * ```typescript
 * // Local development with direct configuration
 * initTracePrompt({
 *   tenantId: 'tnt_dev_local',
 *   apiKey: 'tp_dev_key',
 *   cmkArn: 'local-dev', // Special value for local development
 *   ingestUrl: 'http://localhost:3000',
 *   batchSize: 10,       // Smaller batches for testing
 *   flushIntervalMs: 1000 // Faster flushing for development
 * })
 * ```
 *
 * ### Configuration with YAML File
 * ```bash
 * # Set config file path
 * export TRACEPROMPT_RC=./config/traceprompt.yml
 *
 * # Override specific values via environment
 * export TRACEPROMPT_TENANT_ID=tnt_override_123
 * ```
 *
 * ```typescript
 * // Initialize - will load from YAML + env overrides
 * initTracePrompt()
 * ```
 *
 * ## Override Precedence Example
 * ```typescript
 * // 1. YAML file contains: batchSize: 25
 * // 2. Environment has: TRACEPROMPT_BATCH_SIZE=50
 * // 3. Direct config: { batchSize: 100 }
 * // Result: batchSize = 100 (direct config wins)
 *
 * initTracePrompt({ batchSize: 100 }) // This takes precedence
 * ```
 *
 * ## Validation and Error Handling
 *
 * The configuration system validates all required fields and provides clear error messages:
 *
 * ```typescript
 * // Missing required fields throw descriptive errors
 * initTracePrompt({})
 * // Error: "Traceprompt: tenantId is required"
 *
 * // Invalid values are corrected with warnings
 * initTracePrompt({
 *   tenantId: 'tnt_123',
 *   batchSize: -5 // Invalid - will be reset to default (25)
 * })
 * ```
 *
 * @see {@link TracePromptInit} for complete configuration options
 * @see {@link https://docs.traceprompt.dev/sdk/configuration} for configuration guide
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { TracePromptInit } from "./types";

/**
 * Read and parse a YAML configuration file.
 *
 * Only loads files when explicitly specified. Does not attempt to find
 * default configuration files automatically.
 *
 * @param filePath - Path to the YAML configuration file
 * @returns Parsed configuration object, or empty object if file not found/invalid
 *
 * @example
 * ```typescript
 * // Read custom config file
 * const config = readYaml('/path/to/my-config.yml')
 * ```
 *
 * @internal This function is used internally by the configuration system
 */
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

/**
 * Centralized configuration manager for the Traceprompt SDK.
 *
 * This singleton class handles loading configuration from multiple sources,
 * applying precedence rules, and providing validated configuration to other
 * SDK modules.
 *
 * ## Usage Pattern
 *
 * ```typescript
 * // Initialize configuration (usually done automatically)
 * ConfigManager.load(userConfig)
 *
 * // Access configuration throughout the SDK
 * const { tenantId, cmkArn } = ConfigManager.cfg
 * ```
 *
 * ## Configuration Loading Process
 *
 * 1. **Load YAML file** (if exists)
 * 2. **Load environment variables** (override YAML)
 * 3. **Apply user configuration** (override everything)
 * 4. **Validate required fields** (throw errors for missing values)
 * 5. **Apply defaults** (for optional fields)
 * 6. **Cache result** (for fast subsequent access)
 *
 * @internal This class is used internally by the SDK
 */
class ConfigManagerClass {
  private _cfg?: Required<TracePromptInit>;

  /**
   * Load and validate configuration from all sources.
   *
   * This method is called once during SDK initialization and caches the
   * resolved configuration for fast access by other modules.
   *
   * @param userCfg - Direct configuration object (highest precedence)
   *
   * @throws {Error} If required configuration fields are missing
   * @throws {Error} If configuration values are invalid
   *
   * @example
   * ```typescript
   * // Load with direct configuration
   * ConfigManager.load({
   *   tenantId: 'tnt_123',
   *   apiKey: 'tp_key',
   *   cmkArn: 'arn:aws:kms:...',
   *   ingestUrl: 'https://api.traceprompt.dev'
   * })
   *
   * // Load from environment variables only
   * ConfigManager.load()
   * ```
   *
   * ## Configuration Sources (in precedence order)
   *
   * 1. **userCfg parameter** - Direct configuration object
   * 2. **Environment variables** - `TRACEPROMPT_*` prefixed variables
   * 3. **YAML file** - Only when `TRACEPROMPT_RC` environment variable is set
   * 4. **Built-in defaults** - For optional parameters only
   *
   * ## Required Fields
   * - `tenantId` - Your Traceprompt tenant identifier
   * - `apiKey` - Your Traceprompt API key
   * - `cmkArn` - AWS KMS Customer Master Key ARN (or 'local-dev' for development)
   * - `ingestUrl` - Traceprompt API endpoint URL
   *
   * ## Optional Fields (with defaults)
   * - `batchSize` - Records per batch (default: 25)
   * - `flushIntervalMs` - Maximum time before batch flush (default: 2000ms)
   * - `staticMeta` - Metadata attached to all records (default: {})
   */
  load(userCfg: Partial<TracePromptInit> = {}): void {
    if (this._cfg) return; // already loaded

    /* 1. YAML file (only if explicitly specified) ----------------- */
    const fileCfg = process.env["TRACEPROMPT_RC"]
      ? readYaml(process.env["TRACEPROMPT_RC"])
      : {};

    /* 2. Environment variables ------------------------------------- */
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
    if (!merged.tenantId) throw new Error("Traceprompt: tenantId is required");
    if (!merged.apiKey) throw new Error("Traceprompt: apiKey is required");
    if (!merged.cmkArn) throw new Error("Traceprompt: cmkArn is required");
    if (!merged.ingestUrl)
      throw new Error("Traceprompt: ingestUrl is required");
    if (merged.batchSize! <= 0) merged.batchSize = 25;
    if (merged.flushIntervalMs! <= 0) merged.flushIntervalMs = 2_000;

    this._cfg = merged as Required<TracePromptInit>;
  }

  /**
   * Access the loaded and validated configuration.
   *
   * This getter provides read-only access to the resolved configuration
   * after it has been loaded via the `load()` method.
   *
   * @returns Immutable configuration object with all required fields populated
   *
   * @throws {Error} If `load()` hasn't been called yet (SDK not initialized)
   *
   * @example
   * ```typescript
   * // Access configuration values
   * const config = ConfigManager.cfg
   * console.log(`Tenant: ${config.tenantId}`)
   * console.log(`Batch size: ${config.batchSize}`)
   * console.log(`CMK: ${config.cmkArn}`)
   *
   * // Configuration is read-only
   * // config.tenantId = 'new-value' // TypeScript error
   * ```
   *
   * ## Available Configuration Properties
   *
   * - `tenantId` - Your Traceprompt tenant identifier
   * - `apiKey` - Your Traceprompt API authentication key
   * - `cmkArn` - AWS KMS Customer Master Key ARN for encryption
   * - `ingestUrl` - Traceprompt API endpoint for data ingestion
   * - `batchSize` - Number of records to batch before sending
   * - `flushIntervalMs` - Maximum time to wait before sending incomplete batches
   * - `staticMeta` - Static metadata object attached to all tracked records
   *
   * ## Usage in SDK Modules
   *
   * ```typescript
   * // Encryption module access
   * const { cmkArn } = ConfigManager.cfg
   * const keyring = new AwsKmsKeyringNode({ generatorKeyId: cmkArn })
   *
   * // Transport module access
   * const { ingestUrl, apiKey } = ConfigManager.cfg
   * const response = await fetch(ingestUrl, {
   *   headers: { 'Authorization': `Bearer ${apiKey}` }
   * })
   *
   * // Batcher module access
   * const { batchSize, flushIntervalMs } = ConfigManager.cfg
   * if (queue.length >= batchSize) flush()
   * ```
   */
  get cfg(): Readonly<Required<TracePromptInit>> {
    if (!this._cfg) {
      throw new Error("Traceprompt: initTracePrompt() must be called first");
    }
    return this._cfg;
  }
}

/**
 * Initialize the Traceprompt SDK configuration.
 *
 * This function loads and validates configuration from multiple sources,
 * applying the documented precedence rules. It must be called once before
 * using any other SDK functionality.
 *
 * @param cfg - Optional direct configuration object (highest precedence)
 *
 * @throws {Error} If required configuration fields are missing
 * @throws {Error} If configuration values are invalid
 *
 * @example
 * ```typescript
 * // Initialize with direct configuration
 * initTracePrompt({
 *   tenantId: 'tnt_abc123',
 *   apiKey: 'tp_live_xyz789',
 *   cmkArn: 'arn:aws:kms:us-east-1:123456789:key/your-key-id',
 *   ingestUrl: 'https://api.traceprompt.dev'
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Initialize from environment variables only
 * // Requires TRACEPROMPT_* environment variables
 * initTracePrompt()
 * ```
 *
 * @example
 * ```typescript
 * // Initialize with YAML config file + environment overrides
 * // Set TRACEPROMPT_RC=/path/to/config.yml first
 * initTracePrompt()
 * ```
 *
 * @see {@link TracePromptInit} for complete configuration options
 * @see Module documentation for configuration precedence and examples
 */
export function initTracePrompt(cfg?: Partial<TracePromptInit>): void {
  ConfigManager.load(cfg);
}

/**
 * Singleton configuration manager instance.
 *
 * Used internally by SDK modules to access the loaded configuration.
 * External users should use `initTracePrompt()` instead of accessing this directly.
 *
 * @internal
 */
export const ConfigManager = new ConfigManagerClass();
