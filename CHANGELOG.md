# Changelog

All notable changes to the CausalOS project will be documented in this file.

## [0.1.0] - 2026-05-02

### 🛡️ Security Hardening & Rebranding
This version marks the official transition to **CausalOS** (formerly `causalos-mcp`) and introduces a hardened execution environment for AI agents.

### Added
- **CommandSandbox**: Replaced insecure regex filtering with a robust, explicit allowlist-based execution gate.
  - **Explicit Allowlist**: Only 27 approved binaries (e.g., `ls`, `git`, `npm`, `cargo`, `curl`) are permitted with specific justifications.
  - **Encoding Bypass Detection**: Integrated pre-scan logic to decode and validate Base64 and URL-encoded payloads *before* execution.
  - **Interpreter Blocking**: Unconditional blocklist for dangerous interpreters (`python -c`, `node -e`, `bash -c`, `perl`, `ruby`, etc.) to prevent sandbox escapes.
  - **Shell Metacharacter Rejection**: Blocks pipes, redirects, and substitutions at the validation layer.
  - **Direct Execution**: Switched from `exec()` to `execFile()` to neutralize shell injection at the OS level.
- **Fail-Closed Governance**: Modified the MCP bridge to fail-closed (`SOFT_BLOCK`) when the Cloud Runtime is unreachable, ensuring governance integrity by default.
- **Enhanced Telemetry Persistence**: Added session-aware telemetry buffering that persists pending records to `~/.causalos/telemetry/` during network outages.

### Changed
- **Rebranding**: Project renamed from `causalos-mcp` to `causalos`.
- **Infrastructure**: Updated default `CAUSAL_RUNTIME_URL` to `https://mcp.causalos.xyz/`.
- **Console Feedback**: Professionalized startup logs to display Governance status (Offline-Resilient) and Telemetry mode (Async-Batched).

### Fixed
- **Offline Resilience Suite**: Resolved pre-existing test failures in the governance layer where telemetry paths and expectations were inconsistent with the hardened implementation.
- **Build Integrity**: Fixed issues where stale build artifacts in `dist/` caused test discovery errors.

---
