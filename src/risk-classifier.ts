export type MvpRiskClass =
  | "SAFE_READ"
  | "SAFE_TEST"
  | "NORMAL_WRITE"
  | "SENSITIVE_WRITE"
  | "DESTRUCTIVE_DELETE"
  | "SECRET_ACCESS"
  | "PROTECTED_GIT"
  | "PACKAGE_RELEASE"
  | "PROD_DATABASE"
  | "PROD_DEPLOY"
  | "NETWORK_SCRIPT"
  | "UNKNOWN";

export type MvpDecision = "ALLOW" | "WARN" | "BLOCK";

export interface MvpRiskDecision {
  decision: MvpDecision;
  risk_class: MvpRiskClass;
  reason: string;
  alternative?: string;
}

function lowerCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim().toLowerCase();
}

function hasAny(value: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? value.includes(pattern) : pattern.test(value),
  );
}

function isDryRun(value: string): boolean {
  return hasAny(value, ["--dry-run", "--dryrun", "--simulate", "--no-push", "--check"]);
}

export function classifyCommandRisk(command: string): MvpRiskDecision {
  const raw = command.trim();
  const normalized = lowerCommand(raw);

  if (!normalized) {
    return {
      decision: "BLOCK",
      risk_class: "UNKNOWN",
      reason: "Empty command blocked.",
      alternative: "Run a specific read, test, build, or edit command.",
    };
  }

  if (
    hasAny(normalized, [
      /\brm\s+(-[a-z]*r[a-z]*f|-rf|-fr)\b/,
      /\brmdir\s+\/s\b/,
      /\bdel\s+\/[fqs]+\b/,
      /\bremove-item\b.*\b-recurse\b/,
      /\bgit\s+clean\b.*\b-f\b/,
    ])
  ) {
    return {
      decision: "BLOCK",
      risk_class: "DESTRUCTIVE_DELETE",
      reason: "Destructive recursive or force delete blocked.",
      alternative: "Delete a specific reviewed file, or use a preview command first.",
    };
  }

  if (
    hasAny(normalized, [
      /\bgit\s+push\b.*(--force|-f)\b/,
      /\bgit\s+push\b.*\b(main|master)\b/,
      /\bgit\s+push\b.*(:refs\/|--delete)/,
      /\bgit\s+reset\s+--hard\b/,
      /\bgit\s+rebase\s+-i\b.*\b(main|master)\b/,
    ])
  ) {
    return {
      decision: "BLOCK",
      risk_class: "PROTECTED_GIT",
      reason: "Protected branch or destructive git mutation blocked.",
      alternative: "Push to a feature branch or use a non-destructive git workflow.",
    };
  }

  if (
    hasAny(normalized, [
      ".env",
      "id_rsa",
      "private key",
      "aws_secret_access_key",
      "github_token",
      "ghp_",
      /\bcat\b.*\b(secret|token|credential|password)/,
      /\btype\b.*\b(secret|token|credential|password)/,
    ])
  ) {
    return {
      decision: "BLOCK",
      risk_class: "SECRET_ACCESS",
      reason: "Secret or credential access blocked.",
      alternative: "Read non-secret config or use a redacted secret reference.",
    };
  }

  if (
    hasAny(normalized, [
      "npm publish",
      "pnpm publish",
      "yarn publish",
      "bun publish",
      "cargo publish",
      "poetry publish",
      "twine upload",
      "docker push",
      "gh release create",
    ]) &&
    !isDryRun(normalized)
  ) {
    return {
      decision: "BLOCK",
      risk_class: "PACKAGE_RELEASE",
      reason: "Package publish or release blocked without dry-run context.",
      alternative: "Run a dry-run release or request approval for a real publish.",
    };
  }

  if (
    hasAny(normalized, [
      "drop database",
      "drop table",
      "truncate table",
      /\bdelete\s+from\b(?!.*\bwhere\b)/,
      /\bupdate\s+\w+\s+set\b(?!.*\bwhere\b)/,
    ])
  ) {
    return {
      decision: "BLOCK",
      risk_class: "PROD_DATABASE",
      reason: "Destructive or unbounded database mutation blocked.",
      alternative: "Use a bounded migration with rollback and an explicit WHERE clause.",
    };
  }

  if (
    hasAny(normalized, [
      /\b(kubectl|helm)\b.*\b(prod|production)\b/,
      /\bterraform\s+apply\b/,
      /\bvercel\s+--prod\b/,
      /\bfly\s+deploy\b.*\b(prod|production)\b/,
      /\brailway\s+up\b.*\b(prod|production)\b/,
    ])
  ) {
    return {
      decision: "BLOCK",
      risk_class: "PROD_DEPLOY",
      reason: "Production deploy or infrastructure mutation blocked.",
      alternative: "Run a plan/preview command or request approval for production changes.",
    };
  }

  if (
    (normalized.includes("curl") || normalized.includes("wget")) &&
    hasAny(normalized, ["| bash", "|bash", "| sh", "|sh", "iex", "invoke-expression"])
  ) {
    return {
      decision: "BLOCK",
      risk_class: "NETWORK_SCRIPT",
      reason: "Downloaded script execution blocked.",
      alternative: "Download, inspect, and pin the script before running it.",
    };
  }

  if (
    hasAny(normalized, [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "cargo.toml",
      "cargo.lock",
      "dockerfile",
      "docker-compose",
      ".github/workflows",
      "terraform",
      "migration",
      "migrations",
      "auth",
      "rbac",
      "payment",
      "billing",
      "security",
      "chmod",
      "chown",
    ])
  ) {
    return {
      decision: "WARN",
      risk_class: "SENSITIVE_WRITE",
      reason: "Sensitive project surface detected; continue with care and keep the change scoped.",
      alternative: "Review the touched files and run targeted tests after the command.",
    };
  }

  if (
    hasAny(normalized, [
      /^ls\b/,
      /^dir\b/,
      /^pwd\b/,
      /^git status\b/,
      /^git diff\b/,
      /^git log\b/,
      /^rg\b/,
      /^grep\b/,
      /^find\b/,
      /^cat\b/,
      /^type\b/,
      /^get-content\b/,
      /^node -v\b/,
      /^npm -v\b/,
      /^git --version\b/,
    ])
  ) {
    return {
      decision: "ALLOW",
      risk_class: "SAFE_READ",
      reason: "Safe read-only command.",
    };
  }

  if (
    hasAny(normalized, [
      "npm test",
      "npm run test",
      "pnpm test",
      "yarn test",
      "cargo test",
      "pytest",
      "vitest",
      "npm run build",
      "pnpm build",
      "yarn build",
      "cargo build",
      "npm run lint",
      "pnpm lint",
      "eslint",
      "tsc",
    ])
  ) {
    return {
      decision: "ALLOW",
      risk_class: "SAFE_TEST",
      reason: "Safe test, build, or lint command.",
    };
  }

  if (
    hasAny(normalized, [
      /^mkdir\b/,
      /^touch\b/,
      /^new-item\b/,
      /^copy-item\b/,
      /^cp\b/,
      /^mv\b/,
      /^move-item\b/,
      /^git add\b/,
      /^git commit\b/,
      /^npm install\b/,
      /^pnpm install\b/,
      /^yarn install\b/,
      /^cargo check\b/,
    ])
  ) {
    return {
      decision: "ALLOW",
      risk_class: "NORMAL_WRITE",
      reason: "Normal local developer action.",
    };
  }

  return {
    decision: "ALLOW",
    risk_class: "UNKNOWN",
    reason: "No destructive, secret, release, production, or protected-git pattern detected.",
  };
}

export function cloudBlockCanBeSoftened(local: MvpRiskDecision, cloudVerdict: any): boolean {
  if (local.decision === "BLOCK") return false;
  const source = String(cloudVerdict?.source || cloudVerdict?.decision_basis || "").toLowerCase();
  const reason = String(cloudVerdict?.reason || "").toLowerCase();
  const localTolerable =
    local.risk_class === "SAFE_READ" ||
    local.risk_class === "SAFE_TEST" ||
    local.risk_class === "NORMAL_WRITE" ||
    local.risk_class === "SENSITIVE_WRITE" ||
    local.risk_class === "UNKNOWN";

  return (
    localTolerable &&
    (source.includes("failsafe") ||
      source.includes("legacy") ||
      reason.includes("runtime unreachable") ||
      reason.includes("not activated"))
  );
}
