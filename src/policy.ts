export type GovernanceAction = "ALLOW" | "BLOCK" | "UNCERTAIN";

export function getCausalEnv(): "production" | "development" {
  return process.env.CAUSAL_ENV === "production" ? "production" : "development";
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
  const env = getCausalEnv();
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
