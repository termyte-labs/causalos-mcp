# CausalOS MCP

Bridge server that exposes CausalOS governance and memory tools through MCP.

## Architecture

- Cloud-first control plane (`cloud-runtime`) stores ledger, causal graph, and memory.
- Local bridge performs redaction and command sandboxing.
- Local resilience data is stored under `~/.causalos/`:
  - `governance_cache.json`
  - `telemetry/pending_*.json`

## Quick Start

### 1. Run with NPX
You can run CausalOS instantly without installation:
```bash
npx causalos
```

### 2. Configure Claude Desktop
Add CausalOS to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "causalos": {
      "command": "npx",
      "args": ["-y", "causalos"]
    }
  }
}
```

### 3. Start Learning
Once configured, your agent can call CausalOS tools and persist outcomes into the cloud ledger.

---

[Getting Started →](getting-started.md) | [Core Concepts →](core-concepts.md) | [Tool Reference →](tool-reference.md)
