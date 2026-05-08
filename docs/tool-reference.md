# Termyte MCP Tool Reference

Termyte exposes three MCP tools.

## `context_build`

Call before starting a coding task.

Input:

```json
{
  "task": "Fix failing auth tests",
  "cwd": "/repo/app",
  "project_name": "app",
  "agent": "codex"
}
```

Output includes:

- `session_id`
- `instruction_patch`
- `relevant_failures`
- `constraints`

## `guard_action`

Call before risky non-shell actions.

Input:

```json
{
  "session_id": "...",
  "action_type": "file_delete",
  "intent": "remove generated build directory",
  "payload": { "path": "dist", "recursive": true },
  "cwd": "/repo/app",
  "project_name": "app"
}
```

Output includes:

- `verdict`: `ALLOW`, `WARN`, or `BLOCK`
- `reason`
- `risk_score`
- `matched_patterns`
- `alternative`
- `warning` / `instruction_patch` for `WARN`

`WARN` means proceed with caution and keep the warning in context. It is not a block.

## `execute`

Run shell commands through Termyte governance.

Input:

```json
{
  "command": "npm",
  "args": ["test"],
  "cwd": "/repo/app"
}
```

`execute` blocks destructive commands, warns on similar prior failures, executes allowed commands, and commits sanitized stdout/stderr plus exit code to the runtime.
