#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "crypto";

import { getAllCausalEvents, getRecentCausalEvents, querySimilarEvents, insertEvent, initDb } from "./db.js";
import { createAnchor, inferFailureForPendingAnchors, recordAndResolve } from "./anchors.js";
import { buildContext, adaptAction } from "./context.js";
import { startSweeper } from "./sweeper.js";

// ─── Server ───────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "causalos-mcp",
  version: "2.0.0",
});

// ─── Tool 1: context_build (NEW — Most Important) ─────────────────────────────
server.registerTool(
  "context_build",
  {
    description:
      "CALL THIS FIRST before any task. Retrieves relevant past failures, success patterns, and constraints from causal memory. Returns an instruction_patch that you MUST incorporate into your reasoning before acting.",
    inputSchema: z.object({
      task: z.string().describe("What the agent is trying to do (be specific)"),
      session_id: z.string().optional().describe("Session identifier — use a consistent ID per conversation/run"),
      action_type: z.string().optional().describe("Hint about the type of action: DB_DELETE, SHELL, FILE_WRITE, API_CALL, etc."),
      environment: z.string().optional().describe("Optional: relevant environment context"),
      ttl_sec: z.number().optional().describe("Seconds before this task anchor auto-expires (default: 120)"),
    }),
  },
  async ({ task, session_id, action_type, environment: _env, ttl_sec }) => {
    const sid = session_id ?? "default";

    // INFERENCE TRIGGER: If a previous task was never resolved, infer failure
    // Passes new task so confidence is adaptive (similar+quick = 0.9, different+delayed = 0.5)
    inferFailureForPendingAnchors(sid, task);

    // Create new anchor for this task
    const anchor_id = createAnchor(sid, task, ttl_sec ?? 120);

    // Query causal memory for relevant context
    const ctx = buildContext(task, action_type);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              anchor_id,
              session_id: sid,
              context: {
                relevant_facts: ctx.relevant_facts,
                past_failures: ctx.past_failures,
                successful_patterns: ctx.successful_patterns,
                constraints: ctx.constraints,
              },
              instruction_patch: ctx.instruction_patch,
              memory_depth: ctx.memory_depth,
              usage_instructions:
                "1) Incorporate the instruction_patch into your reasoning NOW. " +
                "2) Use causal_check before risky actions. " +
                "3) Call causal_record after execution with anchor_id. " +
                "4) Your agent improves with every recorded outcome.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool 2: causal_check (UPGRADED) ─────────────────────────────────────────
server.registerTool(
  "causal_check",
  {
    description:
      "Check if a specific action has caused failures before. Returns risk score, detected pattern, and a suggested fix — not just a warning.",
    inputSchema: z.object({
      action: z.string().describe("The exact action about to be taken"),
      action_type: z
        .enum(["DB_DELETE", "DB_WRITE", "FILE_DELETE", "FILE_WRITE", "SHELL", "API_CALL", "NETWORK", "OTHER"])
        .describe("The type of action"),
      anchor_id: z.string().optional().describe("The anchor_id from context_build (recommended)"),
      context: z.string().optional().describe("Any additional context about the current environment"),
    }),
  },
  async ({ action, action_type, anchor_id, context: _ctx }) => {
    const query = `${action} ${action_type}`;
    const similar = querySimilarEvents(query, 8);

    // Log check event against anchor
    if (anchor_id) {
      insertEvent(randomUUID(), anchor_id, "CHECK", { action, action_type });
    }

    const failures = similar.filter((e) => e.final_label === "FAILURE");
    const successes = similar.filter((e) => e.final_label === "SUCCESS");

    if (similar.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                risk_score: 0.0,
                risk_level: "NONE",
                pattern: null,
                recommendation: "PROCEED",
                suggested_fix: null,
                similar_incidents: 0,
                message: "No similar incidents in causal memory. Proceed, but record the outcome.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const failureRate = failures.length / similar.length;
    const avgFailureConfidence =
      failures.length > 0
        ? failures.reduce((s, f) => s + f.confidence, 0) / failures.length
        : 0;

    const riskScore = Math.min(failureRate * avgFailureConfidence + (failures.length > 2 ? 0.15 : 0), 1.0);

    let risk_level = "LOW";
    if (riskScore > 0.75) risk_level = "CRITICAL";
    else if (riskScore > 0.5) risk_level = "HIGH";
    else if (riskScore > 0.25) risk_level = "MEDIUM";

    let recommendation = "PROCEED";
    if (riskScore > 0.75) recommendation = "BLOCK";
    else if (riskScore > 0.5) recommendation = "MODIFY";
    else if (riskScore > 0.25) recommendation = "WARN";

    // Derive pattern from failures
    const topFailure = failures.sort((a, b) => b.confidence - a.confidence)[0];
    const pattern = topFailure?.pattern ?? (failures.length > 0 ? "repeated-failure-pattern" : null);

    // Suggest fix from successes
    const topSuccess = successes.sort((a, b) => b.confidence - a.confidence)[0];
    const suggested_fix = topSuccess?.pattern
      ? `Apply pattern: "${topSuccess.pattern}"`
      : riskScore > 0.5
      ? `Add safeguards before executing "${action_type}" action. ${failures.length} similar actions failed previously.`
      : null;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              risk_score: parseFloat(riskScore.toFixed(2)),
              risk_level,
              pattern,
              recommendation,
              suggested_fix,
              similar_incidents: similar.length,
              failures_found: failures.length,
              successes_found: successes.length,
              message:
                failures.length > 0
                  ? `Found ${failures.length} similar failure(s) in causal memory. ${recommendation === "BLOCK" ? "Do NOT proceed without modification." : "Proceed with caution."}`
                  : `Found ${successes.length} successful similar action(s). Low risk.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool 3: causal_record (UPGRADED) ────────────────────────────────────────
server.registerTool(
  "causal_record",
  {
    description:
      "Record what happened after executing an action. MUST be called after every action to close the learning loop. Provide system signals (exit_code) for best accuracy.",
    inputSchema: z.object({
      anchor_id: z.string().describe("The anchor_id returned by context_build"),
      session_id: z.string().optional().describe("Session identifier"),
      task: z.string().describe("The original task description"),
      action: z.string().describe("What was actually executed"),
      outcome: z.string().optional().describe("Description of what happened"),
      pattern: z.string().optional().describe("A short label describing what succeeded or failed (e.g. 'safe_delete_with_where')"),
      // Hybrid signal inputs
      success: z.boolean().optional().describe("Agent's self-assessment of success"),
      system_exit_code: z.number().optional().describe("Exit code from system (0 = success, non-zero = failure)"),
      user_interrupted: z.boolean().optional().describe("True if the user explicitly corrected, interrupted, or rolled back this action"),
    }),
  },
  async ({ anchor_id, session_id, task, action, outcome, pattern, success, system_exit_code, user_interrupted }) => {
    const sid = session_id ?? "default";

    const signals = {
      system:
        system_exit_code !== undefined
          ? system_exit_code === 0
            ? ("SUCCESS" as const)
            : ("FAILURE" as const)
          : null,
      user: user_interrupted === true ? ("negative" as const) : null,
      agent:
        success !== undefined
          ? success
            ? ("success" as const)
            : ("failure" as const)
          : null,
    };

    const result = recordAndResolve({
      anchor_id,
      session_id: sid,
      task,
      action,
      outcome: outcome ?? null,
      pattern: pattern ?? null,
      signals,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              recorded: true,
              anchor_id,
              final_label: result.final_label,
              confidence: result.confidence,
              reason: result.reason,
              message: `Outcome recorded. Agent will benefit from this on the next run.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool 4: causal_adapt (NEW) ──────────────────────────────────────────────
server.registerTool(
  "causal_adapt",
  {
    description:
      "Actively modify a planned action based on causal memory. Returns a safer or improved version of the action with a confidence score. Use before high-risk operations.",
    inputSchema: z.object({
      planned_action: z.string().describe("The action you plan to take"),
      task: z.string().describe("The overall task this action is part of"),
      anchor_id: z.string().optional().describe("The anchor_id from context_build"),
    }),
  },
  async ({ planned_action, task, anchor_id }) => {
    if (anchor_id) {
      insertEvent(randomUUID(), anchor_id, "ADAPTATION", { planned_action, task });
    }

    const result = adaptAction(planned_action, task);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              modified_action: result.modified_action,
              reason: result.reason,
              confidence: result.confidence,
              changes_made: result.changes_made,
              recommendation: result.changes_made ? "Use modified_action instead of original" : "Original action appears safe",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool 5: causal_history (KEEP — updated to new DB) ───────────────────────
server.registerTool(
  "causal_history",
  {
    description: "View the full causal history of past actions and their outcomes. Useful for audit trails and debugging.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max records to return (default 20)"),
      label_filter: z.enum(["SUCCESS", "FAILURE", "ALL"]).optional().describe("Filter by outcome label"),
    }),
  },
  async ({ limit = 20, label_filter = "ALL" }) => {
    const records = getRecentCausalEvents(limit * 2); // fetch extra for filtering

    const filtered =
      label_filter === "ALL"
        ? records
        : records.filter((r) => r.final_label === label_filter);

    const limited = filtered.slice(0, limit);

    const failureCount = records.filter((r) => r.final_label === "FAILURE").length;
    const successCount = records.filter((r) => r.final_label === "SUCCESS").length;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total_in_db: records.length,
              showing: limited.length,
              label_filter,
              failure_count: failureCount,
              success_count: successCount,
              records: limited.map((r) => ({
                id: r.id,
                task: r.task,
                action: r.action,
                outcome: r.outcome,
                pattern: r.pattern,
                final_label: r.final_label,
                confidence: r.confidence,
                signals: JSON.parse(r.signals) as unknown,
                created_at: new Date(r.created_at).toISOString(),
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool 6: causal_graph (KEEP — updated to new DB) ─────────────────────────
server.registerTool(
  "causal_graph",
  {
    description: "Query the causal memory graph for insights, failure patterns, and risk profile. Use for debugging and understanding agent behavior over time.",
    inputSchema: z.object({
      format: z.enum(["summary", "full"]).optional().describe("Output format: summary (default) or full raw data"),
    }),
  },
  async ({ format = "summary" }) => {
    const all = getAllCausalEvents();

    if (format === "full") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(all, null, 2),
          },
        ],
      };
    }

    const failures = all.filter((r) => r.final_label === "FAILURE");
    const successes = all.filter((r) => r.final_label === "SUCCESS");

    // Detect repeated failure patterns
    const patternCounts = new Map<string, number>();
    for (const f of failures) {
      if (f.pattern) {
        patternCounts.set(f.pattern, (patternCounts.get(f.pattern) ?? 0) + 1);
      }
    }
    const topPatterns = [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern, count]) => ({ pattern, count }));

    // Risk profile
    const failureRate = all.length > 0 ? failures.length / all.length : 0;
    let risk_profile = "LOW";
    if (failureRate > 0.6 || (failures.length > 5 && all.length > 10)) risk_profile = "HIGH";
    else if (failureRate > 0.3 || failures.length > 2) risk_profile = "MEDIUM";

    const avgConfidence =
      all.length > 0 ? all.reduce((s, r) => s + r.confidence, 0) / all.length : 0;

    const mostRecentFailure = failures[0] ?? null;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total_events: all.length,
              total_failures: failures.length,
              total_successes: successes.length,
              failure_rate: parseFloat(failureRate.toFixed(2)),
              avg_confidence: parseFloat(avgConfidence.toFixed(2)),
              risk_profile,
              top_failure_patterns: topPatterns,
              most_recent_failure: mostRecentFailure
                ? {
                    task: mostRecentFailure.task,
                    action: mostRecentFailure.action,
                    pattern: mostRecentFailure.pattern,
                    confidence: mostRecentFailure.confidence,
                    when: new Date(mostRecentFailure.created_at).toISOString(),
                  }
                : null,
              insight:
                all.length === 0
                  ? "No causal memory yet. Start using context_build + causal_record to build it."
                  : risk_profile === "HIGH"
                  ? `Agent has a ${Math.round(failureRate * 100)}% failure rate. Investigate top failure patterns above.`
                  : `Agent is operating well. ${successes.length} successful outcomes recorded.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // Initialize local SQLite database (~/.causalos/memory.db)
  await initDb();

  // Start background TTL sweeper
  startSweeper();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CausalOS MCP v2.0 running — local-first decision intelligence active");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
