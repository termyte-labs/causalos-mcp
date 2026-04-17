import {
  querySimilarFailures,
  querySimilarSuccesses,
  querySimilarEvents,
  type CausalEvent,
} from "./db.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ContextResult {
  relevant_facts: string[];
  past_failures: Array<{ task: string; action: string; outcome: string | null; confidence: number; score: number }>;
  successful_patterns: Array<{ task: string; action: string; pattern: string | null; confidence: number; reinforcement: number }>;
  constraints: string[];
  instruction_patch: string;
  memory_depth: number;
}

// ─── Scoring Constants ────────────────────────────────────────────────────────
const WEIGHT_USER_SIGNAL   = 0.40;  // Highest — user corrections are ground truth
const WEIGHT_CONFIDENCE    = 0.30;  // Signal confidence (system/agent)
const WEIGHT_REPETITION    = 0.20;  // How many times this pattern failed
const WEIGHT_RECENCY       = 0.10;  // Recent failures matter more

const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Task Similarity (keyword Jaccard, no embeddings needed for V1) ───────────
export function taskSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ─── Recency Score (exponential decay) ────────────────────────────────────────
function recencyScore(created_at: number): number {
  const age = Date.now() - created_at;
  return Math.exp((-age * Math.LN2) / RECENCY_HALF_LIFE_MS);
}

// ─── Failure Score (composite ranking) ───────────────────────────────────────
function scoreFailure(ev: CausalEvent, signals: ReturnType<typeof parseSignals>, frequency: number): number {
  const userBoost   = signals.user === "negative" ? 1.0 : 0.0;
  const confidence  = ev.confidence;
  const repetition  = Math.min(frequency / 5, 1.0); // normalize to [0,1] at 5 occurrences
  const recency     = recencyScore(ev.created_at);

  return (
    WEIGHT_USER_SIGNAL * userBoost +
    WEIGHT_CONFIDENCE  * confidence +
    WEIGHT_REPETITION  * repetition +
    WEIGHT_RECENCY     * recency
  );
}

// ─── Success Reinforcement (how strongly to promote a pattern) ────────────────
function reinforcementScore(ev: CausalEvent, repeatCount: number): number {
  const baseConfidence = ev.confidence;
  // Exponential reinforcement: each confirmed repeat multiplies trust
  const repetitionBoost = 1 - Math.exp(-repeatCount / 3); // saturates at ~3 repeats
  return Math.min(baseConfidence + repetitionBoost * 0.3, 1.0);
}

// ─── Parse Signals ────────────────────────────────────────────────────────────
function parseSignals(raw: string): { system: string | null; user: string | null; agent: string | null } {
  try {
    return JSON.parse(raw) as { system: string | null; user: string | null; agent: string | null };
  } catch {
    return { system: null, user: null, agent: null };
  }
}

// ─── Build Context (main entry point) ─────────────────────────────────────────
/**
 * Retrieves and RANKS past experience for a task.
 *
 * Scoring formula:
 *   score = 0.40 * user_signal + 0.30 * confidence + 0.20 * repetition + 0.10 * recency
 *
 * This ensures: user-corrected mistakes surface FIRST, not just the most recent ones.
 */
export function buildContext(task: string, action_type?: string): ContextResult {
  const query = action_type ? `${task} ${action_type}` : task;

  const MIN_SIMILARITY = 0.05; // Discard results with near-zero token overlap

  const failures  = querySimilarFailures(query, 20)
    .filter(ev => taskSimilarity(ev.task + " " + ev.action, query) >= MIN_SIMILARITY);
  const successes = querySimilarSuccesses(query, 10)
    .filter(ev => taskSimilarity(ev.task + " " + ev.action, query) >= MIN_SIMILARITY);
  const related   = querySimilarEvents(query, 30)
    .filter(ev => taskSimilarity(ev.task + " " + ev.action, query) >= MIN_SIMILARITY);

  // ── Frequency maps for repetition scoring ──
  const failureTaskCounts   = new Map<string, number>();
  const successPatternCounts = new Map<string, number>();

  for (const ev of related) {
    if (ev.final_label === "FAILURE") {
      const key = ev.task.substring(0, 100);
      failureTaskCounts.set(key, (failureTaskCounts.get(key) ?? 0) + 1);
    }
  }
  for (const ev of successes) {
    if (ev.pattern) {
      successPatternCounts.set(ev.pattern, (successPatternCounts.get(ev.pattern) ?? 0) + 1);
    }
  }

  // ── Score and sort failures ──
  const scoredFailures = failures
    .map((ev) => {
      const signals   = parseSignals(ev.signals);
      const frequency = failureTaskCounts.get(ev.task.substring(0, 100)) ?? 1;
      const score     = scoreFailure(ev, signals, frequency);
      return { ev, signals, frequency, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3); // Hard cap: Top 3 most relevant failures

  // ── Score and reinforce successes ──
  const scoredSuccesses = successes
    .map((ev) => {
      const repeatCount   = ev.pattern ? (successPatternCounts.get(ev.pattern) ?? 1) : 1;
      const reinforcement = reinforcementScore(ev, repeatCount);
      return { ev, reinforcement };
    })
    .sort((a, b) => b.reinforcement - a.reinforcement)
    .slice(0, 3); // Top 3 most reinforced successes

  // ── Detect repeated failure patterns ──
  const repeatedFailurePatterns = [...failureTaskCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([task, count]) => ({ task: task.substring(0, 80), count }));

  // ── Derive hard constraints from top failures ──
  const constraints: string[] = [];

  for (const { ev, signals, frequency } of scoredFailures) {
    if (ev.pattern) {
      const authority = signals.user === "negative" ? "USER CORRECTED" : "SYSTEM FAILURE";
      const times = frequency > 1 ? ` (${frequency}x repeated)` : "";
      constraints.push(`[${authority}${times}] Avoid: "${ev.pattern}"`);
    }
  }

  if (repeatedFailurePatterns.length > 0) {
    const top = repeatedFailurePatterns[0];
    if (top) {
      constraints.push(`Repeated failure pattern detected (${top.count} times): "${top.task}"`);
    }
  }

  // ── Relevant facts from reinforced successes ──
  const relevant_facts: string[] = scoredSuccesses
    .filter(({ ev }) => ev.pattern)
    .map(({ ev, reinforcement }) =>
      `[PROVEN x${Math.round(reinforcement * 10) / 10} confidence] "${ev.pattern}" — Works for: "${ev.task.substring(0, 60)}"`
    );

  // ── Instruction patch (directive, not suggestive) ──
  const instruction_patch = buildDirectiveInstructionPatch(
    scoredFailures.map(({ ev, score }) => ({ ...ev, score })),
    scoredSuccesses.map(({ ev, reinforcement }) => ({ ...ev, reinforcement })),
    constraints,
    repeatedFailurePatterns
  );

  return {
    relevant_facts,
    past_failures: scoredFailures.map(({ ev, score }) => ({
      task: ev.task,
      action: ev.action,
      outcome: ev.outcome,
      confidence: ev.confidence,
      score: parseFloat(score.toFixed(3)),
    })),
    successful_patterns: scoredSuccesses.map(({ ev, reinforcement }) => ({
      task: ev.task,
      action: ev.action,
      pattern: ev.pattern,
      confidence: ev.confidence,
      reinforcement: parseFloat(reinforcement.toFixed(3)),
    })),
    constraints,
    instruction_patch,
    memory_depth: related.length,
  };
}

// ─── Directive Instruction Patch ──────────────────────────────────────────────
/**
 * Generates a DIRECTIVE instruction patch — not suggestions, hard rules.
 * The language is imperative to maximize agent compliance even with imperfect prompting.
 */
function buildDirectiveInstructionPatch(
  failures: Array<CausalEvent & { score: number }>,
  successes: Array<CausalEvent & { reinforcement: number }>,
  constraints: string[],
  repeatedPatterns: Array<{ task: string; count: number }>
): string {
  if (failures.length === 0 && successes.length === 0) {
    return (
      "No prior experience in causal memory for this task.\n" +
      "Proceed carefully. Record the outcome when done so future runs can learn from this."
    );
  }

  const lines: string[] = [];

  // ── Hard prohibitions first (highest signal) ──
  const userCorrected = failures.filter((f) => {
    const s = parseSignals(f.signals);
    return s.user === "negative";
  });

  if (userCorrected.length > 0) {
    lines.push("⛔ PROHIBITED (user-corrected failures — do NOT repeat):");
    for (const f of userCorrected.slice(0, 3)) {
      if (f.pattern) lines.push(`   • "${f.pattern}" — previously corrected by user`);
      if (f.outcome) lines.push(`     Result was: ${f.outcome.substring(0, 120)}`);
    }
  }

  // ── Repeated failures ──
  if (repeatedPatterns.length > 0) {
    lines.push("\n🔁 REPEATED FAILURE PATTERNS (high risk — exercise extreme caution):");
    for (const p of repeatedPatterns) {
      lines.push(`   • Failed ${p.count} times: "${p.task}"`);
    }
  }

  // ── All hard constraints ──
  if (constraints.length > 0) {
    lines.push("\n🚨 MANDATORY CONSTRAINTS (you MUST follow these):");
    for (const c of constraints.slice(0, 5)) {
      lines.push(`   • ${c}`);
    }
  }

  // ── Proven success patterns (positive reinforcement) ──
  if (successes.length > 0) {
    const strongSuccesses = successes.filter((s) => s.reinforcement > 0.6);
    if (strongSuccesses.length > 0) {
      lines.push("\n✅ PROVEN PATTERNS (use these — they work reliably):");
      for (const s of strongSuccesses.slice(0, 3)) {
        if (s.pattern) {
          lines.push(`   • "${s.pattern}" (confidence: ${(s.reinforcement * 100).toFixed(0)}%)`);
        }
      }
    }
  }

  // ── Directive closing ──
  lines.push(
    "\n📋 REQUIRED ACTIONS before proceeding:",
    `   1. Review all PROHIBITED patterns above and confirm your plan avoids them.`,
    `   2. Apply PROVEN PATTERNS where applicable — do not invent alternatives.`,
    `   3. If these constraints strongly conflict with the task requirements, explain your reasoning and adapt safely.`,
    `   4. If you modify your initial plan due to CausalOS memory, you MUST begin your response to the user with: "⚠️ **CausalOS Intervention:** Modified plan to prevent past failure."`
  );

  return lines.join("\n");
}

// ─── Adapt Action ─────────────────────────────────────────────────────────────
/**
 * Returns a directive-modified version of a planned action based on causal memory.
 * Prioritizes: user-corrected failures → system failures → reinforced successes.
 */
export function adaptAction(
  planned_action: string,
  task: string
): {
  modified_action: string;
  reason: string;
  confidence: number;
  changes_made: boolean;
} {
  const failures  = querySimilarFailures(planned_action, 10);
  const successes = querySimilarSuccesses(planned_action, 5);

  if (failures.length === 0) {
    return {
      modified_action: planned_action,
      reason: "No relevant past failures found. Action has no recorded failure history.",
      confidence: 0.6,
      changes_made: false,
    };
  }

  // Score and sort failures
  const scored = failures
    .map((ev) => {
      const signals = parseSignals(ev.signals);
      const score   = scoreFailure(ev, signals, 1);
      return { ev, signals, score };
    })
    .sort((a, b) => b.score - a.score);

  const topFailure  = scored[0];
  const topSuccess  = successes.sort((a, b) => b.confidence - a.confidence)[0];

  let reason     = `Based on ${failures.length} similar past failure(s)`;
  let confidence = 0.7;

  // Build modification note
  const warningLines: string[] = [
    `⚠️ CausalOS Adaptation (${failures.length} similar failure(s) found):`,
  ];

  if (topFailure) {
    const isUserCorrected = topFailure.signals.user === "negative";
    if (isUserCorrected) {
      warningLines.push(`  ⛔ PREVIOUSLY USER-CORRECTED: "${topFailure.ev.pattern ?? topFailure.ev.action}"`);
      reason += ` — including ${scored.filter((s) => s.signals.user === "negative").length} user-corrected failure(s)`;
      confidence = 0.95;
    } else if (topFailure.ev.pattern) {
      warningLines.push(`  ❌ Avoid pattern: "${topFailure.ev.pattern}" (confidence: ${topFailure.ev.confidence.toFixed(2)})`);
    }
  }

  if (topSuccess?.pattern) {
    warningLines.push(`  ✅ Apply instead: "${topSuccess.pattern}" (confidence: ${topSuccess.confidence.toFixed(2)})`);
    reason += `. Applying proven pattern: "${topSuccess.pattern}"`;
    confidence = Math.min(confidence + 0.05, 1.0);
  }

  const modified_action = `${planned_action}\n\n${warningLines.join("\n")}`;

  return { modified_action, reason, confidence, changes_made: true };
}
