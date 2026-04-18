# CausalOS MCP V1: Agent-Improving Decision Intelligence Layer

## 1. Understanding Summary

*   **What is being built:** A local-first decision intelligence layer that **actively shapes agent reasoning** by injecting structured context (facts, failures, patterns) before execution, resulting in measurable improvement over time.
*   **Why it exists:** To eliminate repeated mistakes and inconsistent behavior in stateless agents by introducing a **persistent learning loop grounded in real outcomes.**
*   **Who it is for:** Primarily Agent Builders (for adoption/validation) and secondarily Local End Users (for immediate value/viral growth).
*   **Key Constraints:**
    *   Local-first memory (`~/.causalos/memory.db`)
    *   No raw data leaves the machine
    *   Cloud optional + additive (for intelligence/monetization)
    *   Works with imperfect integrations
*   **Explicit Non-Goals:** Enterprise compliance/audit workflows, cloud-dependent execution loops, multi-agent orchestration.
*   **Success Definition:** CausalOS is working when the agent avoids repeated mistakes, user intervention drops, and the second run of a task is measurably better than the first (within 1-2 runs).

## 2. Assumptions & Risks

*   **Assumption - Signal Capture:** The V1 system must infer user signals from temporal behavior rather than relying on explicit hooks, since user signals are notoriously unreliable to capture manually.
*   **Assumption - Prompt Compliance:** Agent builders may not flawlessly integrate instructions. Therefore, `context_build` must provide overwhelming value even if partially used.
*   **Risk - Timeouts/Crashes:** In-memory sessions are volatile. Addressed via SQLite DB-backed state.
*   **Risk - False Positives in Inference:** Handled by a strict signal weighting hierarchy (Human > Log > System > Agent).
*   **Risk - Context Dilution:** Project boosting ensures local repo memory isn't "drowned out" by global patterns.

## 3. Decision Log

| Decision Area | Selected Option | Rationale / Trade-offs |
| :--- | :--- | :--- |
| **Go-To-Market Focus** | **Developers (Primary) + Local End Users (Secondary)** | Builders validate the architecture and integration, while local users drive rapid adoption and validate the product value. Enterprise is excluded for V1 due to long sales cycles and trust barriers. |
| **Data & Architecture** | **Local-First Default + Optional Cloud** | Local default ensures zero-latency, full privacy, and trust. Cloud acts purely as an opt-in intelligence amplifier but is never blocking. |
| **Success Evaluation** | **Hybrid Model (Weighted)** | Trust the human most (1.0). Followed by Log diagnostics (0.9) which objectively extract failure patterns. Then system exit codes (0.8) and agent reports (0.5). |
| **Project Intelligence** | **Project-Aware Boosting** | Memory is segmented by `project_name`. Matches within the current project receive a search boost to prioritize repo-specific constraints. |

## 4. Final Design: Soft-State Temporal Anchor + Idempotent Events

### Core Model
Every `context_build` creates a task anchor. Everything that follows (checks, records, new tasks) updates or resolves that anchor. If it isn’t resolved in time, it’s inferred as failed.
Anchor lifecycle: `PENDING` → `RESOLVED` (success/failure) or `EXPIRED` → `INFERRED_FAILURE`

### Data Model (SQLite, local-first)
```sql
table anchors (
  anchor_id TEXT PRIMARY KEY,
  session_id TEXT,
  task TEXT,
  created_at INTEGER,
  expires_at INTEGER,
  status TEXT,          -- PENDING | RESOLVED | EXPIRED
  resolution TEXT,      -- SUCCESS | FAILURE | INFERRED_FAILURE
  confidence REAL
);

table events (
  event_id TEXT PRIMARY KEY,
  anchor_id TEXT,
  type TEXT,            -- CONTEXT_BUILT | CHECK | RECORD | NEW_TASK | TIMEOUT | ADAPTATION
  payload JSON,
  created_at INTEGER
);

table causal_events (
  id TEXT PRIMARY KEY,
  anchor_id TEXT,
  session_id TEXT,
  task TEXT,
  action TEXT,
  outcome TEXT,
  pattern TEXT,
  signals JSON,         -- {system, user, agent, logs}
  final_label TEXT,
  confidence REAL,
  project_name TEXT,    -- Added in V1.1
  working_dir TEXT,     -- Added in V1.1
  logs TEXT,            -- Added in V1.1
  created_at INTEGER
);
create index idx_project on causal_events(project_name);
```

### Runtime Flow

1. **`context_build` (Trigger)**
   - Creates anchor with `ttl_sec` (default 120s).
   - Inserts into `anchors` (`PENDING`) and `events` (`CONTEXT_BUILT`).
2. **Intermediate Checks**
   - Options like `causal_check` log an event (`CHECK`).
3. **`causal_record` (Resolution)**
   - Attaches system + agent signals.
   - Computes weighted outcome.
   - Marks anchor as `RESOLVED`.
4. **Inference Engine (Magic Layer)**
   - **Trigger A (New context_build):** If a previous PENDING anchor exists, mark it `RESOLVED` -> `INFERRED_FAILURE` (Confidence 0.9 = Strong proxy for user interruption).
   - **Trigger B (TTL Expiry Sweeper):** Background sweeper hits pending anchors where `now > expires_at` marking them `EXPIRED` -> `INFERRED_FAILURE`.
5. **Learning Write**
   - Creates `causal_events` feeding into the `context_build` for the next run.

### Key Rules
- **Rule 1:** Anchors persist in SQLite (Not RAM).
- **Rule 2:** Idempotency via `anchor_id`.
- **Rule 3:** Inference over blocking forever.
- **Rule 4:** `context_build` can override default adaptive TTL.

---

[← Agent Integration](agent-integration.md) | [Privacy →](privacy.md)

