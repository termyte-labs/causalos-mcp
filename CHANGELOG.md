# Changelog

All notable changes to the Termyte project will be documented in this file.

## [0.1.4] - 2026-05-10

### 🛡️ Detailed Audit Traces & Enhanced Governance
- **Detailed Audit Traces**: Extended the causal ledger to capture full execution context:
  - `command_args`: The complete arguments array (redacted).
  - `exit_code`: Capture the result code of shell executions.
  - `duration_ms`: High-precision timing for command execution.
  - `stdout/stderr_summary`: Captures the first 200 characters of output (redacted) for debugging.
- **Enhanced `termyte log`**:
  - Color-coded terminal output for better readability.
  - Automatic fallback to `payload_json` for **BLOCKED** actions, ensuring you can see what was blocked and why.
  - Displays command duration and exit status for all executed actions.
- **Improved Redaction**: Sanitizer now redacts sensitive info across all new audit fields.
- **Database Refactor**: Decoupled SQL migrations from the runtime for better manual control and production stability.

## [1.1.0] - 2026-05-08

### 🛡️ Termyte Production Release & Rebranding
- **Official Rebranding**: Fully transitioned project from CausalOS to **Termyte**.
- **Public Domain Migration**: Updated all API endpoints to `mcp.termyte.xyz` and documentation to `docs.termyte.ai`.
- **Governance Refactor**: Standardized on the explicit 3-tool MEP governance model (`context_build`, `guard_action`, `execute`).
- **Safety Memory**: Integrated "Failure Memory" to prevent agents from repeating stochastic hallucinations.
- **Protocol Compliance**: Established `TERMYTE_PROTOCOL.md` as the source of truth for agent safety instructions.

## [1.0.0] - 2026-05-04

### Breaking
- Unified governance verdict policy across MCP + cloud-runtime:
  - Production fails closed (`UNCERTAIN -> BLOCK`)
  - Development returns escalation (`UNCERTAIN`)
- Removed implicit auth fallback (`DEV_BYPASS`) from cloud client headers.
- Added API aliases and canonical docs alignment for:
  - `context/build`, `governance/check`, `ledger/record`

### Added
- Contract tests for cloud endpoint calls.
- E2E smoke stack (`e2e/docker-compose.yml`) with runtime + postgres + smoke runner.
- Runtime policy docs and API docs.

### Fixed
- Version reporting drift in MCP runtime logs.
- Command sandbox tokenization and Windows shell hard-disable for security.

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
