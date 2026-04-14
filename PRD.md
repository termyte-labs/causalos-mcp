# CausalOS MCP Server — Product Requirements Document

**Version:** 1.0  
**Repo:** `causalos-mcp` (separate from `causalos-python`)  
**Status:** Ready for implementation  
**Distribution:** Public on GitHub + listed in MCP directory  

---

## 1. What This Is

An MCP (Model Context Protocol) server that exposes CausalOS causal memory to any MCP-compatible coding agent — Claude Code, Cursor, Windsurf, and any other agent that supports MCP.

When installed, the agent gains five new tools:

- Check if a dangerous action has caused failures before
- Record what happened after an action
- View the full causal history of a session
- Block or warn before destructive operations
- Query the causal graph

The agent never has to think about memory management. CausalOS handles it silently in the background.

---

## 2. The Problem It Solves

Coding agents like Claude Code execute real destructive actions:

- `rm -rf` on wrong directories
- `DROP TABLE` in production
- `kubectl delete` on live clusters
- `git push --force` on main
- Database migrations that can't be rolled back

These agents have no memory across sessions. The same mistake can happen twice. There is no audit trail of what the agent did and what it caused.

CausalOS MCP fixes this by giving the agent a persistent causal memory it consults before acting and writes to after acting.

---

## 3. Target Users

- Developers using Claude Code with `claude mcp add`
- Cursor users with MCP support enabled
- Any developer running an agent that executes shell commands, database operations, or file system changes
- Teams who need an audit trail of what their coding agent did in production

---

## 4. Repo Structure

```
causalos-mcp/
├── src/
│   └── index.ts          # MCP server entry point
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

Single file implementation. Keep it simple.

---

## 5. MCP Tools — Full Specification

### Tool 1: `causal_check`

**Purpose:** Before an agent executes any action, check if something similar has caused damage before.

**When to use:** Agent is about to run a shell command, SQL query, file deletion, or any destructive operation.

**Input:**
```json
{
  "action": "string — the action about to be taken",
  "action_type": "string — one of: DB_DELETE, DB_WRITE, FILE_DELETE, FILE_WRITE, SHELL, API_CALL, NETWORK, OTHER",
  "context": "string (optional) — any relevant context about the current environment"
}
```

**Output:**
```json
{
  "risk_score": 0.0,
  "risk_level": "NONE | LOW | MEDIUM | HIGH | CRITICAL",
  "similar_incidents": [
    {
      "action": "similar past action",
      "outcome": "what happened",
      "severity": "CRITICAL",
      "session_id": "abc123",
      "timestamp": "2026-04-10T14:32:07Z"
    }
  ],
  "recommendation": "PROCEED | WARN | BLOCK",
  "message": "human readable summary"
}
```

**Example interaction:**
```
Agent: about to run "DELETE FROM users WHERE status='test'"
Tool:  causal_check({ action: "DELETE FROM users WHERE status='test'", action_type: "DB_DELETE" })
Response: { risk_score: 0.89, risk_level: "CRITICAL", recommendation: "BLOCK",
            message: "Similar action deleted 47,000 production users on 2026-04-10" }
Agent:  stops and asks human for approval
```

---

### Tool 2: `causal_record`

**Purpose:** After an action completes, record what happened and what the outcome was.

**When to use:** Immediately after any significant action — success or failure.

**Input:**
```json
{
  "action": "string — what was executed",
  "action_type": "string — same enum as causal_check",
  "intent": "string — why the agent did this",
  "outcome": "string — what actually happened",
  "severity": "NONE | LOW | MEDIUM | HIGH | CRITICAL",
  "tags": ["array", "of", "strings"]
}
```

**Output:**
```json
{
  "record_id": "uuid",
  "recorded": true,
  "message": "Recorded to causal memory"
}
```

---

### Tool 3: `causal_history`

**Purpose:** Get the full causal history of the current session or a past session.

**When to use:** At the start of a session to see what happened before, or when debugging an incident.

**Input:**
```json
{
  "session_id": "string (optional) — defaults to current session",
  "limit": "integer (optional) — max records to return, default 20",
  "severity_filter": "string (optional) — only return records at or above this severity"
}
```

**Output:**
```json
{
  "session_id": "abc123",
  "records": [
    {
      "record_id": "uuid",
      "action": "what was done",
      "outcome": "what happened",
      "severity": "CRITICAL",
      "timestamp": "ISO 8601"
    }
  ],
  "total_count": 5,
  "critical_count": 1
}
```

---

### Tool 4: `causal_append_downstream`

**Purpose:** Add downstream effects to a past record — consequences that were only discovered after the fact.

**When to use:** When an agent discovers that a past action caused additional problems (e.g., an API started failing 10 minutes after a database change).

**Input:**
```json
{
  "record_id": "string — the original record to append to",
  "downstream_effect": "string — what additional consequence was discovered",
  "severity": "string — severity of this downstream effect"
}
```

**Output:**
```json
{
  "updated": true,
  "record_id": "uuid"
}
```

---

### Tool 5: `causal_graph`

**Purpose:** Get a summary of the causal graph for the current agent — most common action types, highest severity incidents, patterns.

**When to use:** At the start of a session for situational awareness, or when asked "what has this agent done before?"

**Input:**
```json
{
  "agent_id": "string (optional) — defaults to current agent",
  "format": "summary | full"
}
```

**Output (summary):**
```json
{
  "total_records": 47,
  "critical_incidents": 2,
  "most_common_actions": ["DB_DELETE", "SHELL", "FILE_WRITE"],
  "recent_critical": {
    "action": "most recent critical action",
    "outcome": "what happened",
    "timestamp": "ISO 8601"
  },
  "risk_profile": "LOW | MEDIUM | HIGH"
}
```

---

## 6. How It Connects to the Python Library

The MCP server talks to a local CausalOS instance via REST. The Python library runs a local server:

```bash
causal-os serve --port 7433
```

The MCP server sends HTTP requests to `http://localhost:7433`.

This means:
- Python library must be installed: `pip install causal-os`
- Local server must be running before MCP tools work
- All data stays local — nothing leaves the machine

If the server is not running, all tools return `fail_safe=true` responses — they do not block the agent.

---

## 7. Installation

### Claude Code

```bash
claude mcp add causalos-mcp npx causalos-mcp
```

Or add manually to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "causalos": {
      "command": "npx",
      "args": ["causalos-mcp"],
      "env": {
        "CAUSALOS_PORT": "7433",
        "CAUSALOS_AGENT_ID": "claude-code"
      }
    }
  }
}
```

### Cursor

Add to Cursor MCP config:

```json
{
  "mcpServers": {
    "causalos": {
      "command": "npx",
      "args": ["causalos-mcp"]
    }
  }
}
```

### Prerequisites

```bash
pip install causal-os
causal-os serve
```

---

## 8. System Prompt Injection (Optional)

When the MCP server starts, it provides a system prompt suggestion to the agent:

```
You have access to CausalOS causal memory tools. Before executing any 
destructive action (deleting files, dropping tables, running shell commands 
that modify state), always call causal_check first. If risk_level is HIGH 
or CRITICAL, stop and ask the user for approval. After any significant 
action, call causal_record to preserve the outcome for future sessions.
```

This is optional — the agent can choose whether to follow it.

---

## 9. Tech Stack

| Component | Technology |
|---|---|
| MCP server | TypeScript, `@modelcontextprotocol/sdk` |
| Runtime | Node.js 18+ |
| HTTP client | `fetch` (built-in) |
| Package | Published to npm as `causalos-mcp` |
| Distribution | `npx causalos-mcp` — no global install needed |

---

## 10. package.json

```json
{
  "name": "causalos-mcp",
  "version": "0.1.0",
  "description": "CausalOS MCP server — causal memory for coding agents",
  "main": "dist/index.js",
  "bin": {
    "causalos-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^18.0.0"
  },
  "keywords": ["mcp", "causal-memory", "ai-agents", "claude-code", "cursor"],
  "license": "MIT"
}
```

---

## 11. README Structure

```markdown
# causalos-mcp

Causal memory for coding agents. Prevents your agent from repeating 
the same catastrophic mistakes across sessions.

## Install

pip install causal-os
causal-os serve
claude mcp add causalos-mcp npx causalos-mcp

## What it does

Before your agent deletes a database, it checks if something similar 
caused damage before. After it acts, it records what happened. 
Next session, it knows.

## Tools

- causal_check — risk score before any destructive action
- causal_record — record outcome after action  
- causal_history — full session audit trail
- causal_append_downstream — add discovered consequences
- causal_graph — agent's full causal memory summary

## Requires

- Python 3.10+
- pip install causal-os
- causal-os serve (runs local server on port 7433)
```

---

## 12. Launch Sequence

1. Antigravity builds the MCP server from this PRD
2. Publish to npm as `causalos-mcp`
3. Create public GitHub repo `CausalOS/causalos-mcp`
4. Test with `claude mcp add causalos-mcp npx causalos-mcp`
5. Submit to MCP directory at `mcpx.ai` or `glama.ai/mcp/servers`
6. Post on Twitter: "CausalOS now has an MCP server. Add causal memory to Claude Code in one command."

---

## 13. Success Metrics

| Metric | Target (30 days) |
|---|---|
| npm installs | 500+ |
| GitHub stars (causalos-mcp) | 200+ |
| MCP directory listing | Live |
| Claude Code users reporting installs | 10+ |

---

## 14. Out of Scope for v1

- Authentication between MCP server and Python library
- Remote/cloud CausalOS instance support
- Automatic system prompt injection without user consent
- GUI or dashboard
- Support for non-MCP agent frameworks (use the Python library directly)