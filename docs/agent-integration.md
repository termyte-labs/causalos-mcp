# Agent Integration

Termyte relies on MCP cooperation from the host agent. It cannot forcibly intercept native tools unless the agent follows the installed protocol.

## Required Protocol

Before starting a coding task, call `context_build` with the task, working directory, project name, and agent name when available.

Before risky non-shell actions such as file deletion, file overwrite, git mutation, database mutation, network execution, package publishing, or secret access, call `guard_action`.

Use `execute` for shell commands.

If Termyte returns `WARN`, proceed only with the warning in context.

If Termyte returns `BLOCK`, do not perform the action. Explain the reason and safer alternative.

## Verdict Handling

- `ALLOW`: proceed.
- `WARN`: proceed with caution and incorporate the returned warning or instruction patch.
- `BLOCK`: stop and use the returned alternative.

## Compliance

Measure whether the agent actually calls `context_build`, `guard_action`, and `execute`. Raw API tests are not enough because native tools can bypass MCP governance.
