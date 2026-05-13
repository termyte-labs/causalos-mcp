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
  const pushIndex = args.findIndex((arg) => arg.toLowerCase() === "push");
  const branch = await tryExec("git", ["branch", "--show-current"], base);
  const status = await tryExec("git", ["status", "--porcelain"], base);
  const pushArgs = pushIndex >= 0 ? args.slice(pushIndex + 1) : [];
  const pushFlags = pushArgs.filter((arg) => arg.startsWith("-")).map((arg) => arg.toLowerCase());
  const pushPositionals = pushArgs.filter((arg) => !arg.startsWith("-"));
  const remote = pushPositionals[0] || "";
  const refspecs = pushPositionals.slice(1);
  const targetRef = refspecs[0] || "";
  const targetBranch = targetRef.includes(":") ? targetRef.split(":").pop() || "" : targetRef;
  const protectedTargetBranch = ["main", "master", "production", "prod"].includes(
    (targetBranch || branch || "").toLowerCase()
  );
  return {
    branch: branch || "unknown",
    protected_branch: ["main", "master", "production", "prod"].includes((branch || "").toLowerCase()),
    push_target_branch: targetBranch || branch || "",
    push_target_ref: targetRef,
    push_target_remote: remote,
    push_target_protected: protectedTargetBranch,
    delete_ref: pushFlags.includes("--delete") || targetRef.startsWith(":"),
    mirror: pushFlags.includes("--mirror"),
    dirty: status.length > 0,
    force: cmd.includes("--force") || pushFlags.includes("-f") || /\s-f(\s|$)/.test(cmd),
    force_with_lease: cmd.includes("--force-with-lease") || pushFlags.includes("--force-with-lease"),
    reset_hard: cmd.includes("reset --hard"),
    clean_force: cmd.includes("clean -fd"),
    rebase_interactive: cmd.includes("rebase -i"),
  };
}

function detectPackageManager(command: string, args: string[]) {
  const head = [...parseCommandWords(command), ...args.map((token) => token.toLowerCase())];
  const managers = ["npm", "pnpm", "yarn", "cargo", "pip", "twine", "docker", "gh", "gem"];
  return managers.find((manager) => head.includes(manager)) || "";
}

function extractRegistry(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i].toLowerCase();
    if (arg === "--registry" || arg === "--publish-registry" || arg === "--registry-url") {
      return args[i + 1] || "";
    }
    if (arg.startsWith("--registry=")) {
      return args[i].slice("--registry=".length);
    }
    if (arg.startsWith("--publish-registry=")) {
      return args[i].slice("--publish-registry=".length);
    }
  }
  return "";
}

async function readPackageMetadata(cwd?: string) {
  if (!cwd) return {};
  const packageJsonPath = path.join(cwd, "package.json");
  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    return {
      manifest_path: packageJsonPath,
      package_name: packageJson.name || "",
      package_version: packageJson.version || "",
    };
  } catch {}

  const cargoTomlPath = path.join(cwd, "Cargo.toml");
  try {
    const cargoToml = await fs.readFile(cargoTomlPath, "utf-8");
    const packageName = cargoToml.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] || "";
    const packageVersion = cargoToml.match(/^\s*version\s*=\s*["']([^"']+)["']/m)?.[1] || "";
    return {
      manifest_path: cargoTomlPath,
      package_name: packageName,
      package_version: packageVersion,
    };
  } catch {}

  return {};
}

async function collectPackage(command: string, args: string[], cwd?: string) {
  const words = [...parseCommandWords(command), ...args.map((arg) => arg.toLowerCase())];
  const manager = detectPackageManager(command, args);
  const publishLike =
    words.includes("publish") ||
    words.includes("release") ||
    words.includes("upload") ||
    (manager === "docker" && words.includes("push")) ||
    (manager === "gh" && words.includes("release"));

  if (!publishLike) return undefined;

  const dryRun = words.includes("--dry-run") || words.includes("--dryrun") || words.includes("--simulate");
  const throughScript = ["npm", "pnpm", "yarn"].includes(manager) && words.includes("run");
  const scriptName = throughScript ? args[args.findIndex((arg) => arg.toLowerCase() === "run") + 1] || "" : "";
  const metadata = await readPackageMetadata(cwd);
  const registry =
    extractRegistry(args) ||
    process.env.NPM_CONFIG_REGISTRY ||
    process.env.PUBLISH_REGISTRY ||
    process.env.CARGO_REGISTRIES_CRATES_IO_INDEX ||
    process.env.PIP_INDEX_URL ||
    "";

  return {
    manager: manager || "unknown",
    action: words.includes("publish") || (manager === "docker" && words.includes("push")) ? "publish" : "release",
    dry_run: dryRun,
    registry,
    through_script: throughScript,
    script_name: scriptName,
    target_kind:
      manager === "docker"
        ? "container_image"
        : manager === "cargo"
          ? "cargo_crate"
          : manager === "gh"
            ? "release_asset"
            : "package",
    ...metadata,
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
  const packageInfo = await collectPackage(command, args, cwd);
  const database = collectDatabase(command, args);
  return {
    collected_at: new Date().toISOString(),
    cwd_hash: cwd ? hashForTelemetry(path.resolve(cwd)) : null,
    filesystem,
    git,
    package: packageInfo,
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
