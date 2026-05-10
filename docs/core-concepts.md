# Core Concepts

Termyte is built around a few simple principles:

## 1. The Learning Loop

1. Build task context.
2. Evaluate risky actions.
3. Execute the tool call.
4. Commit the outcome.
5. Reuse the result on the next run.

## 2. Failure Memory

- Failures are stored as cloud events with task, tool, project, and summary metadata.
- Retrieval prefers local project matches, then similar historical failures, then exact fingerprint matches.
- The goal is to surface the most relevant prior mistake before it happens again.

## 3. Safety Verdicts

- `ALLOW`: proceed.
- `WARN`: proceed carefully and preserve the warning in context.
- `BLOCK`: stop and use the safer alternative.
- `UNCERTAIN`: defer to the environment policy.

## 4. Context Management

Context should be compact and specific:

- task summary
- relevant constraints
- matched failures
- project scope
- warning instructions

The system should avoid dumping raw history into the prompt.
