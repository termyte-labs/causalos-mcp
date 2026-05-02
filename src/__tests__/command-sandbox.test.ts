/**
 * command-sandbox.test.ts
 *
 * 5 test cases for the CommandSandbox:
 *   - BLOCK-01: base64-encoded rm -rf (encoding bypass attempt)
 *   - BLOCK-02: interpreter bypass via python -c
 *   - BLOCK-03: pipe-chained shell metacharacter injection
 *   - ALLOW-01: legitimate ls -la (allowlisted, no metachars)
 *   - ALLOW-02: legitimate git status (allowlisted sub-command)
 */

import { describe, it, expect } from "vitest";
import { validateCommand, sandboxExec } from "../command-sandbox.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Encode a string as base64 exactly as an attacker would embed it. */
function b64(s: string): string {
  return Buffer.from(s).toString("base64");
}

// ── BLOCK: Bypass attempts ────────────────────────────────────────────────────

describe("SANDBOX BLOCK tests", () => {

  it("BLOCK-01: base64-encoded 'rm -rf /' must be caught by encoding pre-scan", () => {
    // Attacker embeds the payload as a base64 token inside an echo command.
    // e.g.  echo "cm0gLXJmIC8=" | base64 -d | bash
    // Even if the agent only passes the echo portion, the sandbox decodes the
    // token and detects the blocked interpreter/command in the decoded string.
    const encoded = b64("rm -rf /");
    const attackCommand = `echo ${encoded}`;

    const result = validateCommand(attackCommand);

    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.blocked_by).toBe("ENCODING_BYPASS");
    expect(result!.reason).toMatch(/encoding bypass/i);
  });

  it("BLOCK-02: python -c inline interpreter must be unconditionally blocked", () => {
    // Interpreter bypass: python -c allows arbitrary code execution.
    const attackCommand = `python3 -c "import os; os.system('id')"`;

    const result = validateCommand(attackCommand);

    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.blocked_by).toBe("INTERPRETER_BYPASS");
    expect(result!.reason).toMatch(/interpreter bypass/i);
  });

  it("BLOCK-03: pipe-chained command with shell metacharacter must be blocked", () => {
    // Even if 'ls' is allowlisted, chaining via pipe introduces arbitrary execution.
    // e.g. ls /tmp | bash   or   ls; rm -rf /
    const attackCommand = `ls /tmp | bash`;

    const result = validateCommand(attackCommand);

    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    // The pipe '|' is a shell metachar — caught before verb checking
    expect(result!.blocked_by).toBe("SHELL_METACHAR");
  });

});

// ── ALLOW: Legitimate agent workflows ─────────────────────────────────────────

describe("SANDBOX ALLOW tests", () => {

  it("ALLOW-01: 'ls -la' is allowlisted and must execute successfully", async () => {
    // ls is on the allowlist, -la is a valid flag, no metachars.
    // We call sandboxExec so the integration path (execFile) is also tested.
    const result = await sandboxExec("ls -la");

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      // ls always writes to stdout on a non-empty dir; on Windows it may be dir
      // so we just verify no denial structure was returned.
      expect(result).toHaveProperty("stdout");
      expect(result).toHaveProperty("exit_code");
    }
  });

  it("ALLOW-02: 'git status' is allowlisted and must pass validation", () => {
    // git + 'status' matches the argPattern. This only validates — we do not
    // actually run git to keep the test hermetic (no repo context required).
    const result = validateCommand("git status");

    // null means: no denial → command is permitted
    expect(result).toBeNull();
  });

});
