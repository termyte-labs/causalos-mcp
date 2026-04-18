# Tool Reference

CausalOS MCP provides 6 core tools to manage the learning loop.

## 1. `context_build` (Required)
**Call first before any task.**
Retrieves relevant past experience and provides an instruction patch.

- **Inputs**:
    - `task`: (string, required) Specific description of current task.
    - `session_id`: (string, optional) Unique ID for the conversation.
    - `project_name`: (string, optional) Local repo or project name (enables project-boosting).
    - `action_type`: (string, optional) Hint about type (e.g., `DB_WRITE`).
- **Output**: Returns an `anchor_id`, `context` (past facts), and an `instruction_patch`.

## 2. `causal_check` (Recommended)
**Call before risky actions.**
Checks for specific failure patterns and returns a risk score.

- **Inputs**:
    - `action`: (string, required) Exact action planned.
    - `action_type`: (enum, required) e.g., `SHELL`, `FILE_WRITE`.
    - `anchor_id`: (string, recommended) Id from `context_build`.
    - `project_name`: (string, optional) Contextual repository name.
- **Output**: Returns `risk_score`, `pattern` detected, and `suggested_fix`.

## 3. `causal_record` (Required)
**Call after every outcome.**
Closes the loop by recording what actually happened.

- **Inputs**:
    - `anchor_id`: (string, required)
    - `task`: (string, required)
    - `action`: (string, required)
    - `logs`: (string, optional) **Terminal output for autonomous failure analysis.**
    - `project_name`: (string, optional)
    - `working_dir`: (string, optional)
    - `success`: (boolean, optional) Agent's assessment.
    - `system_exit_code`: (number, optional) OS feedback.
    - `user_interrupted`: (boolean, optional) Proxy for manual correction.

## 4. `causal_adapt`
**Actively modify planned actions.**
Returns a safer "patched" version of a command or code snippet.

- **Inputs**:
    - `planned_action`: (string, required)
    - `task`: (string, required)
    - `project_name`: (string, optional)
- **Output**: Returns `modified_action`, `reason`, and `confidence`.

## 5. `causal_history`
**Audit and debug.**
Returns a list of recent outcomes and patterns.

- **Inputs**:
    - `limit`: (number, optional) Default 20.
    - `label_filter`: (enum, optional) `SUCCESS`, `FAILURE`, or `ALL`.

## 6. `causal_graph`
**High-level insights.**
Summarizes top failure patterns and overall agent risk profile.

---

[← Core Concepts](core-concepts.md) | [Agent Integration →](agent-integration.md)
