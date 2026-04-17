# CausalOS MCP v2.0

> **"Don't just remember the past. Use it to change the future."**

CausalOS MCP is a **local-first decision intelligence layer** for AI agents.
It actively shapes agent reasoning by injecting structured context (past failures, success patterns, constraints) _before_ the agent acts — making it measurably better every run.

---

## What's New in V2

| Feature | V1 | V2 |
| :--- | :--- | :--- |
| Memory | Passive (required Python backend) | Active local-first SQLite |
| Risk check | Warning only | Warning + pattern + suggested fix |
| Context | None | Optimized context injection |
| Learning | None | Continuous hybrid model |
| Behavior change | None | `causal_adapt` tool |
| Dependencies | Requires `causal-os` Python server | **Zero dependencies. Runs standalone.** |

---

## How It Works

```
Task → context_build → Agent → Action → causal_record → Future Improvement
```

1. **`context_build`** — called before every task. Retrieves past failures, success patterns, and an `instruction_patch` for the agent to incorporate.
2. Agent acts (optionally calling `causal_check` and `causal_adapt` before risky operations).
3. **`causal_record`** — called after execution. Closes the learning loop with hybrid signals (system exit code, user interruption, agent self-assessment).
4. On the **next run**, `context_build` surfaces relevant lessons — the agent is better.

### Signal Hierarchy (Human > System > Agent)

| Signal | Weight | Source |
| :--- | :--- | :--- |
| User-interrupted | 1.0 | User correction / Ctrl+C |
| System failure | 0.8 | Non-zero exit code / API error |
| Agent self-report | 0.5 | Agent assessment |

---

## Tools

| Tool | Purpose |
| :--- | :--- |
| `context_build` | **Call first.** Retrieves past experience + instruction patch |
| `causal_check` | Risk check with pattern detection + suggested fix |
| `causal_record` | Record outcome to feed the learning loop |
| `causal_adapt` | Actively modify a planned action based on past failures |
| `causal_history` | View audit trail of past outcomes |
| `causal_graph` | Risk profile and top failure patterns overview |

---

## Installation

```bash
npx causal-os
```

All data is stored locally at `~/.causalos/memory.db`. No backend required.

---

## Agent System Prompt (Mandatory for Best Results)

Add this to your agent's system prompt:

```
Before solving any task:

1. Call `context_build` with the task description to retrieve relevant memory and constraints.
2. Incorporate the returned `instruction_patch` into your reasoning immediately.
3. Before executing risky actions (database writes/deletes, shell commands, file modifications), call `causal_check`.
4. If `suggested_fix` is returned, apply it before proceeding.
5. For high-risk actions, call `causal_adapt` to get a safer version of your planned action.
6. After execution, call `causal_record` with anchor_id, outcome, and available system signals (exit code).

Your goal is not just to complete the task — it is to improve based on past outcomes.
```

---

## Claude Desktop Config

```json
{
  "mcpServers": {
    "causalos": {
      "command": "npx",
      "args": ["-y", "causal-os"]
    }
  }
}
```

---

## Privacy & Architecture

- ✅ **100% local by default** — all memory lives at `~/.causalos/memory.db`
- ✅ **Raw code, queries, and commands never leave your machine**
- ✅ **Zero network dependency** — works offline
- ✅ **Cloud optional** — Pro intelligence features (coming soon)
- ✅ **No native compilation required** — pure JavaScript (sql.js WASM)
