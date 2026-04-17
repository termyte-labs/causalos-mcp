# CausalOS MCP Server Documentation

The CausalOS MCP Server exposes several Model Context Protocol (MCP) tools that allow any MCP-compatible agent to interact with CausalOS. This gives agents a continuous, cross-session causal memory.

## Architecture

The MCP Server is a lightweight Node.js/TypeScript application that communicates with the `causal-os` Python backend via REST API on `http://localhost:7433` (configurable via `CAUSALOS_PORT`). The MCP components are responsible for proxying tools into standard HTTP calls.

## Tools Overview

| Tool Name | Description |
|-----------|-------------|
| `causal_check` | Check if a dangerous action has caused failures before. |
| `causal_record` | Record what happened after an action completes. |
| `causal_history` | View the full causal history of a session. |
| `causal_append_downstream` | Add downstream effects to a past record. |
| `causal_graph` | Query the aggregate causal graph and risk profile. |

---

## Tool Reference

### 1. `causal_check`

**Purpose:** Before executing any destructive action (e.g., executing shell commands, dropping tables), an agent should call this tool. It queries the causal memory to see if similar actions have historically caused issues and returns a risk score.

**Input parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | The exact action about to be taken (e.g., `DROP TABLE users;`). |
| `action_type` | string | Yes | The type of action: `DB_DELETE`, `DB_WRITE`, `FILE_DELETE`, `FILE_WRITE`, `SHELL`, `API_CALL`, `NETWORK`, `OTHER`. |
| `context` | string | No | Relevant surrounding context about the environment. |

**Returns:**
JSON object containing:
- `risk_score`: A float from 0.0 to 1.0 indicating the risk level.
- `risk_level`: String (`NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- `similar_incidents`: Array of past similar events with their consequences and session identifiers.
- `recommendation`: Recommended next step (`PROCEED`, `WARN`, `BLOCK`).
- `message`: Human-readable summary of the findings.

---

### 2. `causal_record`

**Purpose:** After an action completes, record what actually happened to preserve the outcome for future sessions. Both successful outcomes and failures should be recorded, especially for high-stakes actions.

**Input parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | What was executed. |
| `action_type` | string | Yes | Same enum as `causal_check`. |
| `intent` | string | Yes | Why the agent performed the action. |
| `outcome` | string | Yes | What happened (e.g., "Deleted 50 rows", "Command failed with exit code 1"). |
| `severity` | string | Yes | Severity of the outcome (`NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). |
| `tags` | string[] | No | Arrays of string tags for later categorization. |

**Returns:**
JSON object containing:
- `record_id`: The ID of the created causal record.
- `recorded`: Boolean indicating success.
- `message`: Confirmation message.

---

### 3. `causal_history`

**Purpose:** Examine the causal history of a specific session (or the current one). Used primarily for auditing, debugging, and context gathering.

**Input parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | No | The session to query. If omitted, queries the global/current session. |
| `limit` | number | No | Maximum number of records to return. Defaults to `20`. |
| `severity_filter` | string | No | Minimum severity to filter by (e.g., `"MEDIUM"` will return MEDIUM, HIGH, and CRITICAL). |

**Returns:**
A structured history consisting of previous actions, outcomes, and timestamps up to the specified `limit`.

---

### 4. `causal_append_downstream`

**Purpose:** Sometimes consequences of an action aren't immediately clear. If the agent later discovers that a past action triggered an unexpected downstream effect (e.g., an API goes down 10 minutes after a config change), it can append that discovery to the original record.

**Input parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `record_id` | string | Yes | The ID of the original record to append to. |
| `downstream_effect` | string | Yes | Outline of the additional discovered consequence. |
| `severity` | string | Yes | Adjusted severity representing the downstream effect (`NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). |

**Returns:**
Confirmation of update including the updated `record_id`.

---

### 5. `causal_graph`

**Purpose:** Extract a high-level overview or an aggregated graph of the agent's historical actions to understand its overall risk profile.

**Input parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | No | The ID of the agent whose global graph should be queried. |
| `format` | string | No | The format of the returned data. One of `summary` or `full`. Defaults to `summary`. |

**Returns (Summary format):**
- `total_records`: Number of records tracked.
- `critical_incidents`: Number of critical incidents observed.
- `most_common_actions`: The top 3 most common action types performed.
- `recent_critical`: Snapshot of the most recent critical failure.
- `risk_profile`: Overall assessment (`LOW`, `MEDIUM`, `HIGH`).

## Best Practices for Agent Design

If you are writing a custom system prompt to integrate this MCP:
1. **Instruct the agent to check first:** "Before executing any destructive action, always call `causal_check`."
2. **Handle Warnings:** If `recommendation` is `BLOCK` or `WARN`, the agent should pause and ask the human user for explicit approval.
3. **Log Everything Important:** "After any significant action, call `causal_record` to log the outcome."
