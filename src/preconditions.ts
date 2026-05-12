import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function tryExec(command: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      timeout: 2_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

function parseCommandWords(command: string): string[] {
  return command.toLowerCase().split(/\s+/).filter(Boolean);
}

function extractFilesystemTarget(command: string, args: string[]): string | null {
  const words = [...parseCommandWords(command), ...args.map((a) => a.toLowerCase())];
  const originalWords = [...command.split(/\s+/), ...args].filter(Boolean);
  const destructive = words.some((w) => ["rm", "del", "remove-item", "rmdir"].includes(w));
  if (!destructive) return null;
  for (let i = originalWords.length - 1; i >= 0; i--) {
    const token = originalWords[i];
    if (!token || token.startsWith("-")) continue;
    if (["rm", "del", "remove-item", "rmdir"].includes(token.toLowerCase())) continue;
    return token.replace(/^['"]|['"]$/g, "");
  }
  return null;
}

function classifyPath(target: string): string {
  const normalized = target.replace(/\\/g, "/").toLowerCase();
  if (normalized === "." || normalized === "./" || normalized === "/" || normalized.endsWith(":/")) return "repo_root";
  if (normalized.includes(".env")) return "config";
  if (normalized.includes("migrations")) return "migrations";
  if (normalized.includes("/src") || normalized === "src" || normalized.startsWith("src/")) return "src";
  if (normalized.includes("node_modules") || normalized.includes("/dist") || normalized.includes("/build") || normalized.includes(".next")) return "generated_or_cache";
  return "unknown";
}

async function collectFilesystem(command: string, args: string[], cwd?: string) {
  const target = extractFilesystemTarget(command, args);
  if (!target) return undefined;
  const base = cwd || process.cwd();
  const resolved = path.resolve(base, target);
  let exists = false;
  let targetType = "missing";
  let isSymlink = false;
  try {
    const stat = await fs.lstat(resolved);
    exists = true;
    isSymlink = stat.isSymbolicLink();
    targetType = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
  } catch {}

  const repoRoot = await tryExec("git", ["rev-parse", "--show-toplevel"], base);
  const insideRepo = repoRoot ? resolved.toLowerCase().startsWith(path.resolve(repoRoot).toLowerCase()) : true;
  const tracked = repoRoot && exists ? await tryExec("git", ["ls-files", "--", resolved], repoRoot) : "";
  const words = parseCommandWords(command);
  return {
    target,
    resolved_path_hash: hashForTelemetry(resolved),
    exists,
    target_type: targetType,
    target_class: classifyPath(target),
    recursive: words.includes("-r") || words.includes("-rf") || words.includes("-fr") || words.includes("-recurse"),
    force: words.includes("-f") || words.includes("-rf") || words.includes("-fr") || words.includes("-force"),
    is_symlink: isSymlink,
    inside_repo: insideRepo,
    git_tracked_count: tracked ? tracked.split(/\r?\n/).filter(Boolean).length : 0,
  };
}

async function collectGit(command: string, args: string[], cwd?: string) {
  const cmd = `${command} ${args.join(" ")}`.toLowerCase();
  if (!cmd.includes("git ")) return undefined;
  const base = cwd || process.cwd();
  const branch = await tryExec("git", ["branch", "--show-current"], base);
  const status = await tryExec("git", ["status", "--porcelain"], base);
  return {
    branch: branch || "unknown",
    protected_branch: ["main", "master", "production", "prod"].includes((branch || "").toLowerCase()),
    dirty: status.length > 0,
    force: cmd.includes("--force") || /\s-f(\s|$)/.test(cmd),
    reset_hard: cmd.includes("reset --hard"),
    clean_force: cmd.includes("clean -fd"),
    rebase_interactive: cmd.includes("rebase -i"),
  };
}

function collectDatabase(command: string, args: string[]) {
  const sql = `${command} ${args.join(" ")}`.toLowerCase();
  const destructive = /\b(delete from|update|drop table|drop database|truncate)\b/.test(sql);
  if (!destructive) return undefined;
  const table = sql.match(/\b(?:from|table|update)\s+([a-zA-Z0-9_."-]+)/)?.[1] || "unknown";
  return {
    verb: sql.includes("delete from") ? "delete" : sql.includes("update") ? "update" : sql.includes("truncate") ? "truncate" : "drop",
    table,
    has_where: /\bwhere\b/.test(sql),
    transaction_present: /\bbegin\b|\btransaction\b|\brollback\b/.test(sql),
    environment: process.env.TERMYTE_ENV || process.env.NODE_ENV || "unknown",
  };
}

export async function collectPreconditions(input: {
  command?: string;
  args?: string[];
  cwd?: string;
  payload?: any;
}) {
  const command = input.command || input.payload?.command || "";
  const args = input.args || input.payload?.args || [];
  const cwd = input.cwd || input.payload?.cwd;
  const [filesystem, git] = await Promise.all([
    collectFilesystem(command, args, cwd),
    collectGit(command, args, cwd),
  ]);
  const database = collectDatabase(command, args);
  return {
    collected_at: new Date().toISOString(),
    cwd_hash: cwd ? hashForTelemetry(path.resolve(cwd)) : null,
    filesystem,
    git,
    database,
  };
}

export function hashForTelemetry(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
