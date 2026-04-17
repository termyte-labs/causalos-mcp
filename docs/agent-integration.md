# Agent Integration

To get the most out of CausalOS, your agent needs to know *how* and *when* to use the tools.

## The "Golden System Prompt"

Add this to your agent's system prompt (or custom instructions) to enable the CausalOS learning loop:

```markdown
### Decision Intelligence Instructions

Before solving any task:

1. **Memory First**: Always call `context_build` with the current task description to retrieve past failures and success patterns.
2. **Apply Patches**: Incorporate the returned `instruction_patch` into your reasoning immediately.
3. **Risk Check**: Before executing risky actions (database writes, shell commands, file deletes), call `causal_check`. If a `suggested_fix` exists, apply it.
4. **Adaptive Action**: For complex or high-stakes commands, use `causal_adapt` to get an optimized version of the action.
5. **Close the Loop**: After completion, call `causal_record`. Provide system signals (exit codes) if available. 

Your goal is to become measurably more reliable with every task by leveraging this causal memory.
```

## Best Practices

### 1. Be Specific in `context_build`
Don't just say `task: "fix script"`. Preferred: `task: "Update user authentication logic in auth.ts to handle OAuth2"`. Better descriptions lead to better semantic matching in memory.

### 2. Don't Skip `causal_record`
If you skip recording, the system cannot learn. Even if you "fail", recording that failure is what makes the *next* run successful.

### 3. Respond to `risk_score`
If `causal_check` returns a high risk score (> 0.7), you should explain the risk to the user and suggest an alternative *before* acting.

---

[← Tool Reference](tool-reference.md) | [Architecture →](architecture.md)
