# CausalOS MCP

> **"Don't just remember the past. Use it to change the future."**

CausalOS is a **local-first decision intelligence layer** for AI agents. It transforms agents from stateless workers into learning systems that get measurably better with every run.

## Why CausalOS?

Stateless agents often repeat the same mistakes. Even with a large context window, they lack a persistent "muscle memory" for what works and what fails in your specific environment.

CausalOS fixes this by:
1.  **Injecting Context**: Surfacing relevant past failures and success patterns *before* the agent acts.
2.  **Closing the Loop**: Capturing hybrid signals (system exit codes, user interruptions, agent self-reports) to learn from outcomes.
3.  **Adaptive Reasoning**: Providing instruction patches that force agents to avoid known pitfalls.

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
Once configured, your agent will automatically start building a local causal graph at `~/.causalos/memory.db`.

---

[Getting Started →](getting-started.md) | [Core Concepts →](core-concepts.md) | [Tool Reference →](tool-reference.md)
