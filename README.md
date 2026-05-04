# CausalOS MCP Bridge

Node MCP bridge for CausalOS cloud-runtime governance and memory APIs.

## What it provides

- Tool registration for:
  - `context_build`
  - `causal_check`
  - `causalos_execute`
  - `causal_record`
  - `causal_history`
  - `memory_store` / `memory_query`
  - `causal_graph_add`
  - `causal_simulate` / `causal_backtrack`
  - `log_failure`
- Local redaction before cloud submission.
- Local cache + telemetry buffering for resilience.

## Required configuration

Set both:

- `CAUSAL_RUNTIME_URL` (for example, `https://mcp.causalos.xyz`)
- `CAUSAL_API_KEY` (required unless explicitly running dev mode)

Optional:

- `CAUSAL_ENV=production|development`
- `CAUSAL_DEV_MODE=1` (explicit development override only)

## MCP config example

```json
{
  "mcpServers": {
    "causalos": {
      "command": "npx",
      "args": ["-y", "causalos"],
      "env": {
        "CAUSAL_RUNTIME_URL": "https://mcp.causalos.xyz",
        "CAUSAL_API_KEY": "sk-your-key"
      }
    }
  }
}
```
