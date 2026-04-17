import type { FinalLabel, SignalsRecord } from "./db.js";

/**
 * Hybrid signal evaluator.
 *
 * Weighting hierarchy (from design spec):
 *   Human signal  → weight 1.0  (highest authority)
 *   System signal → weight 0.8
 *   Agent signal  → weight 0.5  (weakest — can hallucinate)
 */
export interface EvaluationResult {
  final_label: FinalLabel;
  confidence: number;
  reason: string;
}

export function evaluateSignals(signals: SignalsRecord): EvaluationResult {
  const { system, user, agent } = signals;

  // Human override — absolute highest authority
  if (user === "negative") {
    return {
      final_label: "FAILURE",
      confidence: 1.0,
      reason: "User explicitly corrected or interrupted the action.",
    };
  }

  // System failure is strong and deterministic
  if (system === "FAILURE") {
    return {
      final_label: "FAILURE",
      confidence: 0.8,
      reason: "System reported failure (non-zero exit code or error response).",
    };
  }

  // System success + agent success = confident success
  if (system === "SUCCESS" && agent === "success") {
    return {
      final_label: "SUCCESS",
      confidence: 0.9,
      reason: "Both system and agent confirm task succeeded.",
    };
  }

  // System success only (agent absent)
  if (system === "SUCCESS") {
    return {
      final_label: "SUCCESS",
      confidence: 0.7,
      reason: "System reports success; no agent confirmation.",
    };
  }

  // Only agent signal available — low confidence
  if (agent === "success") {
    return {
      final_label: "SUCCESS",
      confidence: 0.5,
      reason: "Agent self-reported success only (unconfirmed by system).",
    };
  }

  if (agent === "failure") {
    return {
      final_label: "FAILURE",
      confidence: 0.5,
      reason: "Agent self-reported failure (unconfirmed by system).",
    };
  }

  // No usable signals
  return {
    final_label: "FAILURE",
    confidence: 0.2,
    reason: "No reliable signals available; defaulting to FAILURE for safety.",
  };
}
