#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { kernel } from "./client.js";

// ─── Server ───────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "causalos-mcp",
  version: "2.0.0",
});

// ─── Tool 1: context_build (V2 — Kernel Evaluation) ───────────────────────────
server.registerTool(
  "context_build",
  {
    description:
      "CALL THIS FIRST before any task. Retrieves relevant past failures, success patterns, and constraints from causal memory. Returns an instruction_patch that you MUST incorporate into your reasoning before acting.",
    inputSchema: z.object({
      task: z.string().describe("What the agent is trying to do (be specific)"),
      session_id: z.string().optional().describe("Session identifier (Agent ID)"),
      project_name: z.string().optional().describe("The name of the current project (Project ID)"),
      action_type: z.string().optional().describe("Hint about the type of action"),
      environment: z.string().optional().describe("Optional: relevant environment context"),
    }),
  },
  async ({ task, session_id, project_name, action_type }) => {
    const agentId = session_id ?? "default_agent";
    const projectId = project_name ?? "default_project";

    try {
      // Evaluate the task with the Rust Kernel
      const planContract = await kernel.evaluatePlan(agentId, projectId, task);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                contract_hash: planContract.contract_hash,
                risk_score: planContract.risk_score,
                constraints: planContract.required_invariants,
                watchpoints: planContract.watchpoints,
                instruction_patch: `CAUSAL_GUARD_ENGAGED: Risk Score is ${planContract.risk_score}. Follow these invariants: ${planContract.required_invariants.map((i: any) => i.condition).join(", ")}`,
                usage_instructions:
                  "1) Incorporate the instruction_patch into your reasoning NOW. " +
                  "2) Use causal_check before risky actions. " +
                  "3) Call causal_record after execution with contract_hash. " +
                  "4) Your agent improves with every recorded outcome via the Causal Ledger.",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Kernel Error: ${error.message}. Ensure causalos-runtime is running on port 50051.` }],
        isError: true,
      };
    }
  }
);

// ─── Tool 2: causal_check (V2 — Kernel Governance) ───────────────────────────
server.registerTool(
  "causal_check",
  {
    description:
      "Check if a specific action has caused failures before. Returns a Verdict from the Rust Kernel.",
    inputSchema: z.object({
      action: z.string().describe("The exact action about to be taken"),
      action_type: z.string().describe("The type of action"),
    }),
  },
  async ({ action, action_type }) => {
    try {
      const verdict = await kernel.prepareToolCall(action_type, JSON.stringify({ action }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                verdict: verdict.action,
                reason: verdict.reason,
                recommendation: verdict.action === "ALLOW" ? "PROCEED" : "ABORT/MODIFY",
                message: `Kernel Governance: ${verdict.action}. Reason: ${verdict.reason}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Kernel Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool 3: causal_record (V2 — Closing the Loop) ───────────────────────────
server.registerTool(
  "causal_record",
  {
    description:
      "Record what happened after executing an action to close the learning loop in the binary ledger.",
    inputSchema: z.object({
      anchor_id: z.string().describe("The contract_hash or tool_call_id"),
      success: z.boolean().describe("Whether the action was successful"),
      outcome: z.string().describe("Description of what happened"),
      system_exit_code: z.number().optional().describe("Exit code from system"),
    }),
  },
  async ({ anchor_id, success, outcome, system_exit_code }) => {
    try {
      // 1. Record the high-level outcome for the learning loop
      await kernel.recordOutcome(anchor_id, "Standard Completion", success, outcome);
      
      // 2. Commit the specific tool trace
      await kernel.commitToolCall(anchor_id, JSON.stringify({ outcome, exit_code: system_exit_code }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                recorded: true,
                ledger_status: "COMMITTED",
                message: `Outcome recorded in Causal Ledger. The Kernel has learned from this ${success ? "success" : "failure"}.`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Kernel Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool 4: causal_history (V2 — Ledger Trace) ──────────────────────────────
server.registerTool(
  "causal_history",
  {
    description: "View the causal trace of a specific plan from the ledger.",
    inputSchema: z.object({
      plan_hash: z.string().describe("The hash of the plan to trace"),
    }),
  },
  async ({ plan_hash }) => {
    try {
      const trace = await kernel.getCausalTrace(plan_hash);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(trace, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Kernel Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const host = process.env.CAUSAL_RUNTIME_HOST || 'localhost:50051';
  console.error(`CausalOS MCP v2.0 running — gRPC Bridge engaged to Kernel at ${host}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
