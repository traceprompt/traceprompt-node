# Changelog

All notable changes to the TracePrompt Node.js SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
