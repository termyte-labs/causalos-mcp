# CausalOS MCP v1.0

> **"Don't just remember the past. Use it to change the future."**

CausalOS MCP is a **local-first decision intelligence layer** for AI agents.
It actively shapes agent reasoning by injecting structured context (past failures, success patterns, constraints) _before_ the agent acts — making it measurably better every run.

---

## What's New in V1

| Feature | V1.1 (Intelligence Engine) |
| :--- | :--- |
| Memory | Active project-aware SQLite |
| Risk check | Warning + pattern + suggested fix |
| Context | Project-boosted semantic injection |
| Learning | Autonomous log-based diagnostics |
| Behavior change | `causal_adapt` with project memory |
| Logic Analyzer | **Extracts error patterns from logs** |
| Project Intelligence | **Repo-specific memory segmentation** |

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
| **Log diagnostics** | **0.9** | **Detected patterns in terminal logs** |
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
npx causalos-mcp
```

All data is stored locally at `~/.causalos/memory.db`. No backend required.

---

## Agent System Prompt (Mandatory for Best Results)

Add this to your agent's system prompt (or custom instructions) to enable the CausalOS learning loop. This ensures the agent is directive, safer, and self-improves with every run.

```markdown
### 🧠 Causal Decision Intelligence (CRITICAL)

Before solving ANY task, you MUST follow this strict protocol to leverage your causal memory:

1. **Bootstrap**: ALWAYS call `context_build` with the specific task description first. Pass `project_name` (the repo name) for project-specific memory.
2. **Internalize**: Immediately incorporate the returned `instruction_patch` into your reasoning. This patch contains hard constraints and proven patterns from past runs.
3. **Guard**: Before executing any risky action (database writes/deletes, shell commands, file modifications, or API calls), call `causal_check`.
4. **Adapt**: For high-stakes operations, call `causal_adapt` to get a safer or modified version of your planned action.
5. **Acknowledge**: If you modify your initial plan because of memory, you MUST start your response to the user with: "⚠️ **CausalOS Intervention:** Modified plan to prevent past failure."
6. **Learn**: After execution, call `causal_record`. You MUST provide available system signals (`system_exit_code`) and raw `logs` (terminal output) to ensure accurate learning.

Your objective is to become measurably more reliable over time by leveraging this local causal engine.
```

See [Agent Integration](docs/agent-integration.md) for more details on project-level setup.

---

## Claude Desktop Config

```json
{
  "mcpServers": {
    "causalos": {
      "command": "npx",
      "args": ["-y", "causalos-mcp"]
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
