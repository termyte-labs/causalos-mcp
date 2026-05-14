# Termyte MCP

Termyte is a minimum runtime safety layer for coding agents.

By default it gives agents one tool:

- `execute`: run shell commands through Termyte governance and failure-memory checks.

Advanced `context_build` and `guard_action` tools are internal by default and can be exposed with `TERMYTE_EXPOSE_ADVANCED_TOOLS=1` for custom integrations.

## Why It Exists

Coding agents fail in two expensive ways:

1. They run destructive actions too casually.
2. They repeat failed approaches because they do not remember what went wrong.

Termyte blocks clearly destructive actions, warns on similar prior failures, redacts sensitive data, and stores sanitized runtime memory in the cloud so every authorized agent in the same organization can benefit from prior outcomes.

The cloud runtime also persists durable session state, so failure memory can surface the last relevant failure or warning without making the agent run a separate context step.

## Install

```bash
npx termyte init
```

`init` installs MCP config for the detected agent and writes `TERMYTE_PROTOCOL.md` next to the agent config.

`init` also starts browser-mediated login. The terminal opens a Termyte activation URL, the user signs in on the website, and the CLI stores an organization-bound install token in `~/.termyte/config.json`.

Free installs are limited to one active agent session. Team and enterprise organizations can run multiple agents against shared org-scoped memory.

## Agent Protocol

Agents should follow this workflow:

1. Use `execute` for shell commands.
2. Treat `WARN` as proceed-with-caution and keep the warning in context.
3. Treat `BLOCK` as do-not-proceed and explain the safer alternative.

Safe reads, tests, builds, and normal local edits are allowed. Sensitive surfaces warn. Irreversible actions such as secret access, destructive deletes, protected git mutation, package publishing, production database mutation, and production deploys block.

## Verdicts

- `ALLOW`: proceed.
- `WARN`: proceed, but inject the warning or instruction patch into the agent context.
- `BLOCK`: do not perform the action.

## Cloud Data Posture

Termyte sends sanitized task, action, and outcome summaries to the cloud runtime by default. Redaction runs before transmission, judge input, persistence, logs, retrieval, and failure-memory storage.

## Enterprise Controls

- Org-scoped shared memory: no cross-organization retrieval.
- Plan enforcement: free, team, and enterprise active-agent limits are enforced by the runtime.
- Shadow mode: enterprise trials can observe would-block decisions before enforcement.
- Audit timeline: `GET /v1/governance/timeline` reconstructs the causal sequence for demos, incidents, and compliance review.
