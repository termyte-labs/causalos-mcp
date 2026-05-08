# Termyte — Terminal Governance for Coding Agents

Termyte( Prev. CausalOS) is a lightweight, terminal-first governance runtime designed to protect your codebase from catastrophic agent actions (like `rm -rf /` or accidental database drops).
Reached 700+ installs on npm in one single week.
https://www.npmjs.com/package/causalos
https://www.npmjs.com/package/termyte

It provides a secure "Split-Plane" architecture where your coding agent (Claude Code, Cursor, etc.) proposes actions, and Termyte evaluates them against a deterministic sandbox and an LLM judge before execution.

## Features

- **Causal Guard**: Deterministic command analysis for high-risk operations.
- **Agent Ledger**: Every action, verdict, and outcome is recorded in a secure, immutable ledger.
- **Zero-Friction Auth**: Device-based identification (no API keys to manage).
- **Terminal First**: View governance events directly in your terminal with `npx termyte log`.

## Getting Started

### 1. Initialize Termyte
Run this to generate your unique device ID and setup local config:
```bash
npx termyte init
```

### 2. Configure your Agent
Add Termyte as an MCP server to your favorite tool.

#### Claude Code config:
Add the following to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "termyte": {
      "command": "npx",
      "args": ["-y", "termyte"],
      "env": {
        "TERMYTE_API_URL": "https://mcp.causalos.xyz"
      }
    }
  }
}
```

### 3. Usage
Once configured, Termyte will automatically intercept sensitive tool calls. You can monitor the activity:
```bash
npx termyte log
```

## How it Works
1. **Prepare**: The agent calls the `execute` tool with a proposed command.
2. **Judge**: Termyte intercepts the call and evaluates the risk level via the 3-tier safety pipeline.
3. **Commit**: If allowed and executed, Termyte records the stdout/stderr and exit code to the ledger.
