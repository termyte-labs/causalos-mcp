# Changelog

All notable changes to the CausalOS project will be documented in this file.

## [2.0.0] - 2026-04-20

### 🚀 Major Architectural Shift: The Split-Plane Unification

CausalOS V2 represents a complete re-imagining of the agent governance layer. We have moved from a standalone Node.js MCP server to a high-performance **Split-Plane Architecture** that separates intelligence from implementation.

### Added
- **Rust Control Plane**: Introduced `causalos-runtime`, a high-performance governance kernel written in Rust.
- **gRPC Bridge**: Refactored the `causalos-mcp` into a thin gRPC proxy that communicates with the kernel on port `50051`.
- **Causal Ledger (Binary DAG)**: Migrated memory storage to a custom binary ledger for deterministic, linked trajectory storage.
- **2-Phase Commit (2PC) Protocol**: Implemented mandatory `Prepare` and `Commit` cycles for all critical tool calls.
- **Plan Contracts**: Agents now receive "Contracts" with required invariants at the start of every task.
- **Mintlify Documentation**: Brand new documentation suite focusing on the Split-Plane architecture and institutional safety.

### Changed
- **Versioning**: Unified all components (`mcp`, `runtime`, `sdk`) to version `2.0.0`.
- **System Prompt**: Updated the "Golden System Prompt" to enforce the V2 governance protocol.
- **Tooling**: Streamlined tools into `context_build` (V2), `causal_check` (V2), `causal_record` (V2), and `causal_history`.

### Removed
- **Legacy V1 Dependencies**: Removed `better-sqlite3`, `sql.js`, and `natural` from the MCP bridge.
- **Local SQL Database**: Removed `~/.causalos/memory.db` in favor of the Causal Ledger.
- **Legacy Code**: Deleted 5,000+ lines of unused Node.js implementation logic (`db.ts`, `anchors.ts`, `sweeper.ts`, etc.).
