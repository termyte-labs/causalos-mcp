/**
 * CommandSandbox — Hardened shell execution gate for causalos_execute.
 *
 * SECURITY MODEL
 * ──────────────
 * 1. Explicit allowlist: only pre-approved verbs may reach execAsync.
 *    Anything absent from ALLOWED_COMMANDS returns PermissionDenied immediately.
 *
 * 2. Encoding pre-scan: base64 and URL-encoded payloads are decoded and
 *    re-evaluated against the allowlist BEFORE the raw command is checked.
 *    If the decoded form is blocked, the raw call is blocked too.
 *
 * 3. Interpreter bypass blocking: scripting interpreters that accept inline
 *    code (-c / -e / -r flags) are explicitly blacklisted regardless of what
 *    follows them — they are a superset of the shell and cannot be allowlisted.
 *
 * 4. Argument safety: even allowlisted commands are re-checked for embedded
 *    shell metacharacters (pipe, redirect, backtick, command substitution)
 *    that would promote them to arbitrary execution.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SandboxResult {
  allowed: true;
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface SandboxDenial {
  allowed: false;
  reason: string;
  blocked_by: "INTERPRETER_BYPASS" | "ENCODING_BYPASS" | "NOT_IN_ALLOWLIST" | "SHELL_METACHAR" | "ARGUMENT_INJECTION";
}

export type SandboxOutcome = SandboxResult | SandboxDenial;

// ── Allowlist ─────────────────────────────────────────────────────────────────
// Each entry: { verb, allowedFlags?, justification }
// `verb` is the binary name that must appear as argv[0] (no path traversal).
// Only the verb is checked — not the full path — so callers must NOT pass
// absolute paths like /bin/ls; they pass "ls" and execFile resolves it via PATH.

interface AllowedCommand {
  verb: string;
  /** Optional: regex that all remaining tokens must collectively match.
   *  If absent, all non-metachar arguments are allowed. */
  argPattern?: RegExp;
  justification: string;
}

const ALLOWED_COMMANDS: AllowedCommand[] = [
  // ── File-system inspection (read-only) ──────────────────────────────────────
  {
    verb: "ls",
    justification: "List directory contents; read-only filesystem probe needed by agents.",
  },
  {
    verb: "cat",
    justification: "Read a single file's content; no mutation, needed for config inspection.",
  },
  {
    verb: "head",
    justification: "Preview first N lines of a file; read-only, agents use it for log sampling.",
  },
  {
    verb: "tail",
    justification: "Preview last N lines; read-only, used for log tail in diagnostics.",
  },
  {
    verb: "find",
    justification: "Locate files by name/type; read-only traversal, needed for project audits.",
  },
  {
    verb: "stat",
    justification: "File metadata inspection; read-only, used for permission audits.",
  },
  {
    verb: "wc",
    justification: "Word/line count on files; read-only metric tool.",
  },
  {
    verb: "diff",
    justification: "Compare two files; read-only, needed for patch validation.",
  },
  {
    verb: "grep",
    justification: "Pattern search in files; read-only, essential for log analysis.",
  },
  {
    verb: "sort",
    justification: "Sort text input; pure transformation, no side-effects.",
  },
  {
    verb: "uniq",
    justification: "Deduplicate sorted lines; pure transformation, no side-effects.",
  },
  {
    verb: "cut",
    justification: "Extract fields from text; pure transformation, no side-effects.",
  },
  {
    verb: "awk",
    // awk -f scriptfile is allowed; awk 'prog' or awk -v OFS= are blocked via argPattern
    argPattern: /^(-F\S+\s+)?(-v\s+\w+=\S+\s+)?-f\s+\S+(\s+\S+)*$/,
    justification: "Script-file mode awk only (-f flag); inline -f-less programs are blocked to prevent code injection.",
  },
  {
    verb: "sed",
    // Only -n / -e with simple s/search/replace patterns; no arbitrary exec
    argPattern: /^(-n\s+)?'s\/[^/]+\/[^/]*\/(g|p|)?'\s+\S+$/,
    justification: "Substitution-only sed; -n and s/// pattern. No -e with arbitrary expressions.",
  },
  {
    verb: "pwd",
    justification: "Print working directory; read-only, used for path resolution checks.",
  },
  {
    verb: "env",
    // env with no arguments only — printing the environment for diagnostics
    argPattern: /^$/,
    justification: "Print environment variables with no arguments; read-only diagnostic.",
  },

  // ── Package management (read-only queries) ──────────────────────────────────
  {
    verb: "npm",
    argPattern: /^(list|ls|outdated|audit|view|info|doctor|pack|run\s+\S+)(\s+.*)?$/,
    justification: "npm read-only sub-commands: list, outdated, audit, view, run <script>. install/publish excluded.",
  },
  {
    verb: "npx",
    argPattern: /^-y\s+\S+/,
    justification: "npx in non-interactive mode (-y flag required); needed for scaffolding helpers.",
  },
  {
    verb: "git",
    argPattern: /^(status|log|diff|show|branch|remote|fetch|pull|clone|tag|stash\s+list|describe)(\s+.*)?$/,
    justification: "git read+pull operations; push/commit excluded. Agents need repo inspection.",
  },

  // ── Build tools ─────────────────────────────────────────────────────────────
  {
    verb: "tsc",
    justification: "TypeScript compiler; needed for build validation tasks.",
  },
  {
    verb: "cargo",
    argPattern: /^(build|test|check|clippy|fmt|doc)(\s+.*)?$/,
    justification: "Rust build/check sub-commands; publish/install excluded.",
  },

  // ── Process / system inspection (read-only) ─────────────────────────────────
  {
    verb: "echo",
    justification: "Print literal strings; used in scripted status messages by agents.",
  },
  {
    verb: "date",
    justification: "Print current date/time; read-only, used in log stamps.",
  },
  {
    verb: "uptime",
    justification: "System uptime; read-only health probe.",
  },
  {
    verb: "df",
    justification: "Disk free space; read-only, used in storage health checks.",
  },
  {
    verb: "du",
    argPattern: /^-[shHLPd0-9]*(\s+\S+)*$/,
    justification: "Disk usage summary; -s/-h flags only, read-only.",
  },
  {
    verb: "ps",
    argPattern: /^(-[Aaxefuww]+)?(\s+.*)?$/,
    justification: "Process list inspection; read-only, used for runtime diagnostics.",
  },
  {
    verb: "which",
    justification: "Locate a binary on PATH; read-only, used for environment validation.",
  },
  {
    verb: "uname",
    justification: "OS/kernel version; read-only, used for environment fingerprinting.",
  },
  {
    verb: "hostname",
    justification: "Machine hostname; read-only, used in telemetry context.",
  },

  // ── Network inspection (read-only) ──────────────────────────────────────────
  {
    verb: "curl",
    // Only safe read operations: no -X PUT/DELETE/POST, no --data, no -o write
    argPattern: /^(-s|-S|-i|-L|-v|--head|-I|--retry\s+\d+|--connect-timeout\s+\d+|-H\s+'\S[^']*'|\s)*https?:\/\/\S+$/,
    justification: "HTTP GET only; --data/-X POST/PUT/DELETE excluded. Needed for health-check probes.",
  },
  {
    verb: "ping",
    argPattern: /^-c\s+\d+\s+\S+$/,
    justification: "ICMP ping with explicit count limit (-c N host); needed for connectivity tests.",
  },
];

// Build a fast lookup set of allowed verbs for O(1) first-pass check
const ALLOWED_VERBS = new Set(ALLOWED_COMMANDS.map((c) => c.verb));

// ── Interpreter bypass list ───────────────────────────────────────────────────
// These binaries accept inline code via flags and are unconditionally blocked
// regardless of the arguments that follow them.

const BLOCKED_INTERPRETERS = new Set([
  "python",
  "python2",
  "python3",
  "py",
  "node",
  "nodejs",
  "deno",
  "bun",
  "perl",
  "perl5",
  "ruby",
  "rb",
  "php",
  "lua",
  "tclsh",
  "wish",
  "bash",
  "sh",
  "zsh",
  "ksh",
  "fish",
  "dash",
  "csh",
  "tcsh",
  "pwsh",
  "powershell",
  "cmd",
  "eval",       // shell built-in — cannot reach execFile but guard anyway
  "exec",       // same
  "xargs",      // can construct and execute arbitrary commands
  "env",        // blocked as verb when it has arguments (env sh -c …)
  "chroot",
  "nsenter",
  "unshare",
  "strace",
  "ltrace",
  "gdb",
  "lldb",
  "osascript",  // macOS AppleScript interpreter
]);

// ── Shell metacharacter pattern ───────────────────────────────────────────────
// Reject any command string that contains shell control operators.
// These would only be meaningful if passed through a shell (execFile does not
// invoke a shell, so they would fail at runtime anyway — but we reject early
// to prevent confusion and future regressions).

const SHELL_METACHAR_RE = process.platform === "win32"
  ? /[;&|`$()<>^{}\n]/  // Backslash allowed on Windows, added Caret (^) as it is a metachar
  : /[;&|`$()<>\\{}\n]/;

// ── Base64 / URL-encoding detector ───────────────────────────────────────────

// Require at least 2 groups of 4 base64 chars (8 chars = 6 meaningful bytes).
// This catches short payloads like 'rm -rf /' (base64: 12 chars) while
// avoiding false-positives on short word-tokens like "INFO" or "AKIA".
const BASE64_TOKEN_RE = /(?:[A-Za-z0-9+/]{4}){2,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;
const URL_ENCODED_RE = /%[0-9A-Fa-f]{2}/;

function tryDecodeBase64(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    // Heuristic: if decoded string is printable ASCII, treat it as meaningful
    if (/^[\x20-\x7E\n\r\t]+$/.test(decoded)) {
      return decoded;
    }
  } catch {
    // not valid base64 — ignore
  }
  return null;
}

function tryDecodeUrl(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Extract and decode all base64/URL tokens from a raw command string.
 * Returns an array of decoded strings that should be inspected for blocked content.
 */
function extractDecodedPayloads(rawCommand: string): string[] {
  const payloads: string[] = [];

  // 1. URL-decode the entire string if it contains percent-escapes
  if (URL_ENCODED_RE.test(rawCommand)) {
    payloads.push(tryDecodeUrl(rawCommand));
  }

  // 2. Extract and decode individual base64 tokens
  const b64Matches = rawCommand.match(BASE64_TOKEN_RE) ?? [];
  for (const token of b64Matches) {
    const decoded = tryDecodeBase64(token);
    if (decoded) {
      payloads.push(decoded);
    }
  }

  return payloads;
}

// ── Core validation ───────────────────────────────────────────────────────────

/**
 * Parse a raw command string into [verb, ...args] tokens.
 * We intentionally do NOT support shell expansion — splitting on whitespace
 * (respecting simple single-quoted strings) is deliberately conservative.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (ch === "'" && !inSingleQuote && !inDoubleQuote) {
      inSingleQuote = true;
    } else if (ch === "'" && inSingleQuote && !inDoubleQuote) {
      inSingleQuote = false;
    } else if (ch === "\"" && !inSingleQuote && !inDoubleQuote) {
      inDoubleQuote = true;
    } else if (ch === "\"" && inDoubleQuote && !inSingleQuote) {
      inDoubleQuote = false;
    } else if (ch === " " && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Strip leading path components so "/usr/bin/python3" → "python3".
 * Callers should never pass absolute paths, but we normalise defensively.
 */
function extractVerb(token: string): string {
  // Handle Unix paths
  const slash = token.lastIndexOf("/");
  if (slash !== -1) return token.slice(slash + 1);
  // Handle Windows paths
  const backslash = token.lastIndexOf("\\");
  if (backslash !== -1) return token.slice(backslash + 1);
  return token;
}

/**
 * Validate a single parsed command string.
 * Returns null if allowed, or a SandboxDenial if blocked.
 */
function validateParsed(command: string): SandboxDenial | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allowed: false, reason: "Empty command string.", blocked_by: "NOT_IN_ALLOWLIST" };
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0 || tokens[0] === undefined) {
    return { allowed: false, reason: "Empty token list after parsing.", blocked_by: "NOT_IN_ALLOWLIST" };
  }

  const verb = extractVerb(tokens[0] as string);

  // ── Gate 1: interpreter bypass ──────────────────────────────────────────────
  if (BLOCKED_INTERPRETERS.has(verb.toLowerCase())) {
    return {
      allowed: false,
      reason: `Interpreter bypass blocked: '${verb}' is unconditionally denied regardless of arguments. Use an allowlisted tool instead.`,
      blocked_by: "INTERPRETER_BYPASS",
    };
  }

  // ── Gate 2: allowlist ───────────────────────────────────────────────────────
  if (!ALLOWED_VERBS.has(verb)) {
    return {
      allowed: false,
      reason: `Command '${verb}' is not on the approved allowlist. PermissionDenied.`,
      blocked_by: "NOT_IN_ALLOWLIST",
    };
  }

  // ── Gate 3: shell metacharacters ────────────────────────────────────────────
  // Even an allowlisted verb must not carry shell control operators.
  if (SHELL_METACHAR_RE.test(trimmed)) {
    return {
      allowed: false,
      reason: `Shell metacharacter detected in command. Chaining, redirection, and substitution are not permitted.`,
      blocked_by: "SHELL_METACHAR",
    };
  }

  // ── Gate 4: optional per-command argument pattern ───────────────────────────
  const entry = ALLOWED_COMMANDS.find((c) => c.verb === verb)!;
  if (entry.argPattern) {
    const argsStr = tokens.slice(1).join(" ").trim();
    if (!entry.argPattern.test(argsStr)) {
      return {
        allowed: false,
        reason: `Arguments '${argsStr}' for '${verb}' do not match the permitted argument pattern. Potential argument injection.`,
        blocked_by: "ARGUMENT_INJECTION",
      };
    }
  }

  return null; // all gates passed
}

/**
 * Full validation: checks the raw command AND any decoded payloads embedded in it.
 */
export function validateCommand(rawCommand: string): SandboxDenial | null {
  // 1. Check decoded payloads FIRST so encoded bypasses are caught before the raw string
  const decodedPayloads = extractDecodedPayloads(rawCommand);
  for (const payload of decodedPayloads) {
    // Each decoded payload may itself contain a command — check its verb
    const denial = validateParsed(payload);
    if (denial) {
      return {
        ...denial,
        reason: `Encoding bypass detected: decoded payload '${payload.slice(0, 120)}' is blocked. Reason: ${denial.reason}`,
        blocked_by: "ENCODING_BYPASS",
      };
    }
  }

  // 2. Validate the raw command itself
  return validateParsed(rawCommand);
}

// ── Public execution entry point ──────────────────────────────────────────────

/**
 * Execute a shell command through the sandbox.
 *
 * Uses execFile (not exec) so the OS does NOT invoke a shell — the verb is
 * treated as a binary name and arguments are passed as a plain array.
 * This eliminates shell injection at the OS level in addition to the
 * validation layer above.
 */
export async function sandboxExec(rawCommand: string, timeoutMs = 30_000): Promise<SandboxOutcome> {
  if (process.platform === "win32") {
    return {
      allowed: false,
      reason: "Windows shell execution is disabled in this release. Use dedicated file/search/build tools instead.",
      blocked_by: "NOT_IN_ALLOWLIST",
    };
  }

  // Validate first
  const denial = validateCommand(rawCommand);
  if (denial) return denial;

  // Parse tokens for execFile
  const tokens = tokenize(rawCommand.trim());
  // tokens[0] is guaranteed non-empty here because validateCommand passed above
  const verb = extractVerb(tokens[0] as string);
  const args = tokens.slice(1);

  try {
    const { stdout, stderr } = await execFileAsync(verb, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB max output
      windowsHide: true,
      shell: false,
    });
    return { allowed: true, stdout, stderr, exit_code: 0 };
  } catch (err: any) {
    // execFile throws on non-zero exit; capture the output
    return {
      allowed: true, // the sandbox permitted it — the command itself failed
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exit_code: err.code ?? 1,
    };
  }
}
