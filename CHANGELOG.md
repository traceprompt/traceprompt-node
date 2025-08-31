# Changelog

All notable changes to the TracePrompt Node.js SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-31

### Added

- **Agent and Tool Tracing**: Complete support for AI agent workflows with audit-grade tracing

  - `wrapAgent()` function for tracing entire agent sessions as root spans
  - `wrapTool()` function for tracing tool executions with separate ToolCall and ToolResult spans
  - Agent identity configuration via `.tracepromptrc.yml` or environment variables
  - Stable agent IDs, versions, and fingerprints for compliance tracking

- **Audit-Grade Trace Integrity**

  - Deterministic event ordering with monotonic `event_index` per trace
  - Hash-chain integrity with `prev_event_hash` linking events
  - AgentRun spans always emitted as root spans (event_index=1, prev_event_hash=null)
  - Content integrity hashes (`plaintext_hash` and `ciphertext_hash`) for audit proofs

- **Enhanced Span Types**

  - Added `ToolResult` as first-class span type separate from `ToolCall`
  - Proper parent-child relationships between AgentRun → ToolCall → ToolResult → ModelCall
  - Request ID correlation (`client_request_id`, `provider_request_id`, `model_request_id`)

- **Configuration-Driven Agent Identity**

  - Agent metadata configurable via `.tracepromptrc.yml` agent section
  - Environment variable support for all agent identity fields
  - Agent fingerprinting using BLAKE3 hashes for change detection
  - Policy profile support for compliance frameworks

- **Token Usage Alignment**
  - Prefer provider token counts over local estimation when available
  - Added `usage_source` field ("provider" vs "local") for audit transparency
  - Added `usage_method` field for local counting methods ("tiktoken")

### Changed

- **Breaking**: Agent workflows now require `wrapAgent()` instead of generic `wrap()`
- **Breaking**: Tool calls now emit two separate spans (ToolCall + ToolResult) instead of one
- Updated span correlation to enforce proper parent-child hierarchies
- Enhanced configuration loading to support agent identity defaults

### Fixed

- AgentRun spans now properly emitted at agent start, not completion
- Hash chain integrity now maintains linear ordering across all span types
- Content hashes now properly differentiate between plaintext and ciphertext
- Removed all testing mode bypasses for production readiness

## [1.1.0] - 2024-01-15

### Added

- **Graceful shutdown support**: SDK now traps SIGTERM/SIGINT signals, flushes the ring-buffer and persistent outbox, and exits with non-zero status if any data remains unsent
- **Retry logic with exponential backoff**: Failed flush attempts are retried with exponential backoff (500ms → 1s → 2s → 4s)
- **Complete outbox drain**: During shutdown, the SDK ensures the entire persistent outbox is emptied before exiting
- **Proper exit codes**: Process exits with code 1 if graceful shutdown fails, allowing Kubernetes to detect and handle failures
- **Public graceful shutdown API**: Exposed `PersistentBatcher.gracefulShutdown()` for custom lifecycle management
- **Enhanced logging**: Added detailed debug logs for shutdown process and retry attempts

### Changed

- **Signal handling**: Replaced basic signal handlers with comprehensive graceful shutdown logic
- **Blocking behavior during shutdown**: New events are rejected with an error once shutdown begins

### Fixed

- **Data loss prevention**: Eliminates silent data loss when containers/processes are terminated during deployments

## [1.0.3] - Previous Release

- Previous functionality (graceful shutdown not yet implemented)
