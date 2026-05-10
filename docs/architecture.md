# Termyte MCP V1: Agent Governance and Memory Layer

## Understanding Summary

- Termyte is a cloud-backed decision and memory layer for agents that run tools.
- It injects structured context before execution so the next run can avoid the same failure.
- It is aimed at coding agents and the developers who need them to be safer.

## Current Constraints

- All authoritative memory lives in the cloud runtime.
- The MCP client redacts sensitive data before transmission.
- The bridge can fail closed if the runtime is unavailable.
- The product currently optimizes for code-execution workflows, not general-purpose multi-agent orchestration.

## Decision Log

| Area | Current Choice |
|---|---|
| Go-to-market | Coding agents and agent builders |
| Data model | Cloud-backed ledger, failure events, and derived signatures |
| Retrieval | Task, project, action, and fingerprint-based memory lookup |
| Safety | Deterministic policy first, memory match second, judge last |

## Runtime Flow

1. `context_build` creates a task anchor and fetches prior failures.
2. `guard_action` evaluates high-risk non-shell actions.
3. `execute` calls `prepare`, runs the command, then calls `commit`.
4. The cloud runtime writes the resulting trail into the ledger and failure memory.

## Success Definition

Termyte is working if it reduces repeated failures, improves recovery after errors, and blocks risky actions before they cause damage.
