import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

/**
 * Tokenize a command string into a binary and its arguments.
 * Handles single/double quotes and backslash escaping.
 */
export function tokenize(command: string): string[] {
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
 * Ensures batch commands on Windows are invoked with .cmd extension.
 */
export function resolveWindowsVerb(verb: string): string {
  if (process.platform !== "win32") return verb;
  const batchCommands = ["npm", "npx", "yarn", "pnpm", "tsc", "cargo"];
  if (batchCommands.includes(verb.toLowerCase())) {
    return `${verb}.cmd`;
  }
  return verb;
}

/**
 * Execute a command natively after it has passed Termyte Governance.
 * Uses execFile (not exec) to prevent shell injection at the OS level.
 */
export async function nativeExec(rawCommand: string, timeoutMs = 30_000): Promise<ExecutionResult> {
  const tokens = tokenize(rawCommand.trim());
  const rawVerbToken = tokens[0];
  if (!rawVerbToken) throw new Error("Empty command");
  
  // Extract verb (strip path) and resolve Windows extension
  const rawVerb = rawVerbToken.replace(/^.*[\\\/]/, "");
  const verb = resolveWindowsVerb(rawVerb);
  const args = tokens.slice(1);

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(verb, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB max output
      windowsHide: true,
      shell: false,
    });
    return { stdout, stderr, exit_code: 0, duration_ms: Date.now() - start };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exit_code: err.code ?? 1,
      duration_ms: Date.now() - start
    };
  }
}
