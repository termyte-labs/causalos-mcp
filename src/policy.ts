export type GovernanceAction = "ALLOW" | "BLOCK" | "UNCERTAIN";

export function getTermyteEnv(): "production" | "development" {
  return process.env.TERMYTE_ENV === "production" ? "production" : "development";
}

export function normalizeVerdict(
  action: GovernanceAction,
): GovernanceAction {
  if (action === "ALLOW" || action === "BLOCK" || action === "UNCERTAIN") {
    return action;
  }
  return "UNCERTAIN";
}

export function applyUnifiedPolicy(action: GovernanceAction): GovernanceAction {
  const env = getTermyteEnv();
  if (env === "production") {
    return action === "ALLOW" ? "ALLOW" : "BLOCK";
  }
  return action === "ALLOW" ? "ALLOW" : "UNCERTAIN";
}

export function recommendationFor(action: GovernanceAction): "PROCEED" | "ABORT" | "ESCALATE" {
  if (action === "ALLOW") return "PROCEED";
  if (action === "BLOCK") return "ABORT";
  return "ESCALATE";
}
