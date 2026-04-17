# Getting Started

Setup CausalOS in minutes and give your agent a persistent memory.

## Prerequisites

- **Node.js**: v18 or higher.
- **MCP Client**: Claude Desktop, VS Code (via MCP extension), or any other MCP-compliant interface.

## Installation

CausalOS is designed to be run via `npx` for zero-configuration setup.

### Global Installation (Optional)
If you prefer to install it globally:
```bash
npm install -g causal-os
```

## Configuration

### Claude Desktop
Edit your configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the following entry:
```json
{
  "mcpServers": {
    "causal-os": {
      "command": "npx",
      "args": ["-y", "causal-os"]
    }
  }
}
```

### Environment Variables
By default, CausalOS stores data in `~/.causalos/`. You can override this:

- `CAUSALOS_PATH`: Path to the directory where `memory.db` will be stored.

## Verifying the Setup

After restarting your MCP client, ask your agent:
> "Do you have the CausalOS tools available?"

The agent should confirm it has access to `context_build`, `causal_check`, etc.

---

[← Overview](index.md) | [Core Concepts →](core-concepts.md)
