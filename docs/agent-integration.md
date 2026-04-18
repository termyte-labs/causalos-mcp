# Agent Integration

To get the most out of CausalOS, your agent needs to know *how* and *when* to use the tools.

## The "Golden System Prompt"

Add this to your agent's system prompt (or custom instructions) to enable the CausalOS learning loop. This ensures the agent is directive, safer, and self-improves with every run.

```markdown
### 🧠 Causal Decision Intelligence (CRITICAL)

Before solving ANY task, you MUST follow this strict protocol to leverage your causal memory:

1. **Bootstrap**: ALWAYS call `context_build` with the specific task description first. Pass `project_name` (e.g., the folder or repo name) to enable project-specific memory boosting.
2. **Internalize**: Immediately incorporate the returned `instruction_patch` into your reasoning. This patch contains hard constraints and proven patterns from past runs.
3. **Guard**: Before executing any risky action (database writes/deletes, shell commands, file modifications, or API calls), call `causal_check`.
4. **Adapt**: For high-stakes operations, call `causal_adapt` to get a safer or modified version of your planned action.
5. **Acknowledge**: If you modify your initial plan because of memory, you MUST start your response to the user with: "⚠️ **CausalOS Intervention:** Modified plan to prevent past failure."
6. **Learn**: After execution, call `causal_record`. You MUST provide available system signals (`system_exit_code`) and raw `logs` (terminal output) to ensure accurate learning.

Your objective is to become measurably more reliable over time by leveraging this local causal engine.
```

## Project-Level Integration

To ensure *every* agent (Claude, Cursor, Cascade, etc.) that enters this repository follows the CausalOS loop, add the protocol above to your project's main instruction file.

### 1. Claude Code (`.clauderules`)
Add the script above to a `.clauderules` file in your root directory. Claude Code will automatically read this and prioritize context building.

### 2. Cursor (`.cursorrules`)
Include the Decision Intelligence instructions in your `.cursorrules`. This ensures Cursor's Composer and Chat modes respect the causal memory.

### 3. Stitch / Cascade (`STITCH.md` or `DESIGN.md`)
Add a section titled `## CausalOS Protocol` to your `STITCH.md`. Cascade agents are trained to look for these files and follow the integrated instructions.

---

## Best Practices

### 1. Be Specific in `context_build`
Don't just say `task: "fix script"`. Preferred: `task: "Update user authentication logic in auth.ts to handle OAuth2"`. Better descriptions lead to better semantic matching in memory.

### 2. Don't Skip `causal_record`
If you skip recording, the system cannot learn. Even if you "fail", recording that failure is what makes the *next* run successful.

### 3. Respond to `risk_score`
If `causal_check` returns a high risk score (> 0.7), you should explain the risk to the user and suggest an alternative *before* acting.

### 4. Continuous Log Capture
Professional integrations should pipe the output of every critical shell command into the `logs` field of `causal_record`. This allows CausalOS to detect:
- `TypeError` or `SyntaxError` in scripts.
- `Permission denied` or `Command not found` in environments.
- `panic` or stack traces in backend logs.

By capturing raw logs, CausalOS can objectively identify a failure even if the agent is biased or the system exit code is misleading.

---

[← Tool Reference](tool-reference.md) | [Architecture →](architecture.md)
