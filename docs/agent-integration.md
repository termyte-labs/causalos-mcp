# Agent Integration

Termyte relies on MCP tool cooperation in the solo-developer MEP. It cannot forcibly intercept native agent tools unless the agent follows the installed protocol.

## Required Protocol

Add or verify these instructions for your agent:

```markdown
### Termyte Protocol

Before starting any coding task, call `context_build` with the task, cwd, project name, and agent name when available.

Before risky non-shell actions such as file deletion, file overwrite, git mutation, database mutation, network execution, package publishing, or secret access, call `guard_action`.

Use `execute` for shell commands.

If Termyte returns `WARN`, proceed only with the warning in context.

If Termyte returns `BLOCK`, do not perform the action. Explain the reason and safer alternative.
```

`npx termyte init` writes a `TERMYTE_PROTOCOL.md` file near the detected agent config. You must verify whether your agent reads that file or add the protocol to its custom/project instructions.

## Verdict Handling

- `ALLOW`: proceed.
- `WARN`: proceed with caution and incorporate the returned warning/instruction patch.
- `BLOCK`: stop and use the returned alternative.

## Protocol Compliance

For evaluation, measure whether the agent actually calls `context_build`, `guard_action`, and `execute`. Raw API tests are not enough because native tools can bypass MCP governance.
