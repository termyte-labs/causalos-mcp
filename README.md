# CausalOS v2.0: Deterministic Governance Layer

> **"Don't just anticipate the future. Govern it."**

CausalOS V2 is a high-integrity **Deterministic Governance Layer** for AI agents. It transitions from a simple memory store to a **Split-Plane Architecture**, enforcing safety guardrails and closed-loop learning across every agent trajectory.

---

## 🚀 The V2 Split-Plane Architecture

V2 introduces a clear separation between implementation and governance:

1.  **Control Plane (The Kernel)**: A high-performance Rust sidecar that manages the **Causal Ledger (Binary DAG)** and enforces **Plan Contracts**.
2.  **Data Plane (The Bridge)**: A lightweight Node.js/gRPC bridge that interfaces with any MCP-capable host (Claude Desktop, IDEs, etc.).

---

## ✨ Key Features in V2

- **2-Phase Commit (2PC) Protocol**: Mandatory `Prepare -> Simulate -> Commit` loop for all critical tools.
- **Binary Causal Ledger**: High-speed, cryptographically linked trajectory storage.
- **Plan Contracts**: Deterministic safety requirements injected into agent context via `contract_hash`.
- **Hard Safety Gates**: Physical blocking of high-risk tool calls with historical failure density > 0.8.
- **Institutional Observability**: OpenTelemetry integration for tracing governance decisions.

---

## ☁️ CausalOS Cloud (Recommended)

Move the governance kernel to the cloud. No local Rust dependencies required.

### 1. Get an API Key
Sign up at [causalos.xyz](https://causalos.xyz) and generate an API key.

### 2. Update Configuration
Add your API key to the environment variables:
```json
{
  "mcpServers": {
    "causalos": {
      "command": "npx",
      "args": ["-y", "causalos-mcp"],
      "env": {
        "CAUSAL_API_KEY": "sk-your-key-here"
      }
    }
  }
}
```

## 🛠 Local Setup (Advanced)

### 1. Launch the Runtime Kernel
The Rust Kernel must be active for the MCP bridge to function.
```bash
cd runtime/sidecar
cargo run --release
```
*The Kernel listens on gRPC port 50051.*

### 2. Configure the MCP Bridge
Update your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "causalos": {
      "command": "npx",
      "args": ["-y", "causalos-mcp"],
      "env": {
        "CAUSAL_RUNTIME_HOST": "localhost:50051"
      }
    }
  }
}
```

---

## 🧠 The V2 Golden System Prompt

To enable the V2 learning loop, add this to your agent's system prompt:

```markdown
### Deterministic Governance Protocol (CausalOS)

You are equipped with a CausalOS Governance Layer. You MUST follow this 2nd-Phase Commit (2PC) protocol:

1. **Contract Signing (`context_build`)**: Call this before ANY task to receive your `contract_hash` and `Required Invariants`.
2. **Pre-Execution Check (`causal_check`)**: Call this before any tool with side effects. Strictly follow the Kernel's `verdict` (ALLOW/BLOCK).
3. **Loop Closure (`causal_record`)**: Call this after execution with the `contract_hash`. Provide exit codes and outcome summaries.
```

---

## 📄 Privacy, Performance & Failsafes
- ✅ **Hybrid Connectivity**: Automatically falls back to local sidecar if `CAUSAL_API_KEY` is missing.
- ✅ **Cloud Failsafe**: In Cloud mode, tool checks have a strict **200ms timeout**. If the cloud is unreachable, the call is `SOFT_ALLOW`-ed and logged locally to prevent agent hang.
- ✅ **Ultra Low Latency**: <50ms cloud round-trip including DB resolution.
- ✅ **Zero Hallucination**: Outcome hashes ensure memory integrity.

---
[Full Documentation](https://docs.causalos.com) | [Core Concepts](docs/essentials/core-concepts.mdx) | [Architecture](docs/essentials/architecture.mdx)
