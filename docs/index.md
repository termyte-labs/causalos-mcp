# Termyte MCP

Bridge server that exposes Termyte governance and memory tools through MCP.

## Architecture

- Cloud-first control plane (`cloud-runtime`) stores the ledger, graph, and memory.
- Local bridge performs redaction and command sandboxing.
- Configuration and cache data live under `~/.termyte/`.

## Quick Start

### 1. Run with NPX

```bash
npx termyte
```

### 2. Configure Your MCP Client

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

### 3. Start Learning

Once configured, your agent can call Termyte tools and persist outcomes into the cloud ledger.

---

[Getting Started](getting-started.md) | [Core Concepts](core-concepts.md) | [Tool Reference](tool-reference.md)
