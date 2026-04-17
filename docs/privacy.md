# Privacy & Security

CausalOS was built with a "Privacy First, Privacy Only" philosophy.

## Local-First Architecture

By default, 100% of the intelligence and data storage happens on your local machine.

- **Storage**: All task logs, code snippets, and failure patterns are stored in a local SQLite database at `~/.causalos/memory.db`.
- **Compute**: Semantic matching and causal inference are performed locally within the Node.js process.
- **Networking**: CausalOS does *not* send your data to any external cloud service or telemetry engine.

## Data Encryption

Since the data is stored locally, it is as secure as your file system. We recommend using full-disk encryption (like FileVault or BitLocker) to secure your local environment.

## Transparency

You can audit exactly what CausalOS knows about you at any time:

1.  **Direct SQL**: Open `~/.causalos/memory.db` with any SQLite viewer.
2.  **Tooling**: Run `causal_history` or `causal_graph` through your MCP client to see the distilled patterns.

## Cloud Opt-In (Coming Soon)

Future versions may offer "Intelligence Shairng" as an opt-in feature. This would allow you to download anonymous failure patterns found by other developers to improve your agent's initial performance. This will always be **opt-in** and strictly **anonymous**.

---

[← Agent Integration](agent-integration.md) | [Architecture →](architecture.md)
