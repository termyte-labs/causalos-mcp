import { randomUUID } from "crypto";
import {
  insertAnchor,
  insertEvent,
  insertCausalEvent,
  resolveAnchor,
  expireAnchor,
  getPendingAnchorsForSession,
  type SignalsRecord,
  type Resolution,
} from "./db.js";
import { evaluateSignals } from "./signals.js";
import { taskSimilarity } from "./context.js";

const DEFAULT_TTL_SEC = 120;

// How quickly after an anchor was created do we consider a new task an interruption?
// If > this threshold AND tasks are dissimilar, confidence drops from 0.9 → 0.6
const INTERRUPTION_THRESHOLD_MS = 30_000; // 30 seconds

// ─── Create Anchor ────────────────────────────────────────────────────────────
export function createAnchor(session_id: string, task: string, ttl_sec = DEFAULT_TTL_SEC): string {
  const anchor_id = randomUUID();
  insertAnchor(anchor_id, session_id, task, ttl_sec);
  insertEvent(randomUUID(), anchor_id, "CONTEXT_BUILT", { task, ttl_sec, session_id });
  return anchor_id;
}

// ─── Check for Pending Anchors + Auto-Infer Failure ──────────────────────────
/**
 * Called at the TOP of every context_build call.
 *
 * Inference confidence is now ADAPTIVE:
 *
 *  High confidence (0.9) — task is SIMILAR and switch happened QUICKLY
 *    → Strong proxy for user interruption / agent failure
 *
 *  Lower confidence (0.6) — task is DIFFERENT or switch happened after long delay
 *    → Could be intentional task switch, not a failure
 *
 * This prevents over-aggressive failure inference that corrupts the learning model.
 */
export function inferFailureForPendingAnchors(session_id: string, newTask: string): void {
  const pending = getPendingAnchorsForSession(session_id);

  for (const anchor of pending) {
    const now           = Date.now();
    const timeSince     = now - anchor.created_at;
    const similarity    = taskSimilarity(anchor.task, newTask);

    // Adaptive confidence: recent + similar = strong user interruption signal
    // Long delay + dissimilar = deliberate task switch (lower signal weight)
    let inferenceConfidence: number;
    let reason: string;

    if (timeSince < INTERRUPTION_THRESHOLD_MS && similarity > 0.3) {
      // Quick switch on similar task → very likely agent failed or user corrected
      inferenceConfidence = 0.9;
      reason = `Quick task switch (${Math.round(timeSince / 1000)}s) with similar task — likely user interruption`;
    } else if (timeSince < INTERRUPTION_THRESHOLD_MS) {
      // Quick switch but different topic → probable deliberate context change
      inferenceConfidence = 0.65;
      reason = `Quick context switch (${Math.round(timeSince / 1000)}s) to different task — possible deliberate switch`;
    } else if (similarity > 0.3) {
      // Long delay but similar task → inconclusive, moderate confidence
      inferenceConfidence = 0.7;
      reason = `Similar task after delay (${Math.round(timeSince / 1000)}s) — previous task likely abandoned`;
    } else {
      // Long delay + different task → intentional pivot, lowest failure signal
      inferenceConfidence = 0.5;
      reason = `Different task after delay (${Math.round(timeSince / 1000)}s) — treating as deliberate task pivot`;
    }

    expireAnchor(anchor.anchor_id, "INFERRED_FAILURE", inferenceConfidence);
    insertEvent(randomUUID(), anchor.anchor_id, "NEW_TASK", {
      reason,
      similarity: parseFloat(similarity.toFixed(3)),
      time_elapsed_ms: timeSince,
      new_task: newTask.substring(0, 100),
      inference_confidence: inferenceConfidence,
    });

    // Only record a causal_event worth learning from if confidence is meaningful
    if (inferenceConfidence >= 0.6) {
      insertCausalEvent({
        id: randomUUID(),
        anchor_id: anchor.anchor_id,
        session_id: anchor.session_id,
        task: anchor.task,
        action: anchor.task,
        outcome: `Inferred failure: ${reason}`,
        signals: {
          system: null,
          user: inferenceConfidence >= 0.8 ? "negative" : null,
          agent: null,
        },
        final_label: "FAILURE",
        confidence: inferenceConfidence,
      });
    }
  }
}

// ─── Resolve Anchor via causal_record ────────────────────────────────────────
export interface RecordInput {
  anchor_id: string;
  session_id: string;
  task: string;
  action: string;
  outcome?: string | null;
  pattern?: string | null;
  signals: SignalsRecord;
  project_name?: string | null;
  working_dir?: string | null;
}

export function recordAndResolve(input: RecordInput): {
  final_label: string;
  confidence: number;
  reason: string;
} {
  const evaluation = evaluateSignals(input.signals);

  const resolution: Resolution = evaluation.final_label === "SUCCESS" ? "SUCCESS" : "FAILURE";
  resolveAnchor(input.anchor_id, resolution, evaluation.confidence);
  insertEvent(randomUUID(), input.anchor_id, "RECORD", {
    signals: input.signals,
    final_label: evaluation.final_label,
    confidence: evaluation.confidence,
  });

  insertCausalEvent({
    id: randomUUID(),
    anchor_id: input.anchor_id,
    session_id: input.session_id,
    task: input.task,
    action: input.action,
    outcome: input.outcome ?? null,
    pattern: input.pattern ?? null,
    signals: input.signals,
    final_label: evaluation.final_label,
    confidence: evaluation.confidence,
    project_name: input.project_name ?? null,
    working_dir: input.working_dir ?? null,
  });

  return {
    final_label: evaluation.final_label,
    confidence: evaluation.confidence,
    reason: evaluation.reason,
  };
}

// ─── TTL Expiry (used by sweeper) ─────────────────────────────────────────────
export function expireTimedOutAnchor(anchor_id: string, session_id: string, task: string): void {
  expireAnchor(anchor_id, "INFERRED_FAILURE", 0.7);
  insertEvent(randomUUID(), anchor_id, "TIMEOUT", {
    reason: "TTL expired before resolution",
  });
  insertCausalEvent({
    id: randomUUID(),
    anchor_id,
    session_id,
    task,
    action: task,
    outcome: "Inferred: TTL expired before resolution",
    signals: { system: null, user: null, agent: null },
    final_label: "FAILURE",
    confidence: 0.7,
  });
}
