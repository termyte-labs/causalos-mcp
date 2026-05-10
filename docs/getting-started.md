# Getting Started

Set up Termyte in minutes and give your agent governed memory.

## Prerequisites

- Node.js v18 or higher.
- An MCP client such as Claude Desktop, VS Code with MCP support, or another compatible host.

## Installation

```bash
npm install -g termyte
```

Or use it directly:

```bash
npx termyte
```

## Configuration

### Claude Desktop

```json
{
  "mcpServers": {
    "termyte": {
      "command": "npx",
      "args": ["-y", "termyte"]
    }
  }
}
```

### Environment Variables

- `TERMYTE_DEVICE_ID`: optional explicit device identifier.
- `TERMYTE_API_URL`: optional override for the cloud runtime URL.

## Verifying the Setup

After restarting your MCP client, ask your agent whether the `context_build`, `guard_action`, and `execute` tools are available.

---

[Overview](index.md) | [Core Concepts](core-concepts.md)
