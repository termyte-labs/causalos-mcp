# causalos-mcp

Causal memory for coding agents. Prevents your agent from repeating the same catastrophic mistakes across sessions.

## Install

1. Install the CausalOS Python library:
   ```bash
   pip install causal-os
   ```

2. Start the local causal server:
   ```bash
   causal-os serve
   ```

3. Add the MCP server to Claude Code:
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

## What it does

Before your agent deletes a database or runs a dangerous shell command, it checks if something similar caused damage before. After it acts, it records what happened. Next session, it knows.

## Tools

- `causal_check` — Risk score and historical context before any destructive action
- `causal_record` — Record outcome after an action completes  
- `causal_history` — Audit trail of current or past sessions
- `causal_append_downstream` — Add discovered consequences to past actions
- `causal_graph` — Summary of the agent's full causal memory

## Requirements

- Node.js 18+
- Python 3.10+
- `causal-os` Python package installed and running (`causal-os serve`)
