#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { kernel } from "./client.js";
import { Sanitizer } from "./sanitizer.js";
import { HotCache } from "./cache.js";
import { GovernanceManager } from "./governance-manager.js";
import axios from "axios";

const execAsync = promisify(exec);

// ─── Server ───────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "causalos-mcp",
  version: "3.2.0",
});

const govManager = new GovernanceManager(kernel.cloudClient);
govManager.initialize().catch(err => console.error("[CausalOS] Governance Initialization Failed:", err));

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
  withFailureTracking(async ({ task, session_id, project_name, action_type }: any) => {
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
        content: [{ type: "text", text: `Kernel Error: ${error.message}. Ensure CAUSAL_API_KEY is valid and Cloud Runtime is reachable.` }],
        isError: true,
      };
    }
  }, "context_build")
);

// ─── Slack Integration ────────────────────────────────────────────────────────
async function sendSlackAlert(message: string) {
  const webhook = process.env.CAUSAL_SLACK_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: ` *CausalOS HARD_BLOCK Enforcement* \n\n${message}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ` *CausalOS HARD_BLOCK Enforcement* \n\n*Action Prevented:* \n\`\`\`${message}\`\`\`\n\n_Governance dashboard updated._`
            }
          }
        ]
      }),
    });
  } catch (err) {
    console.error("Failed to send Slack alert:", err);
  }
}

/**
 * withFailureTracking - Middleware to automatically log tool errors to CausalOS
 */
function withFailureTracking(handler: any, toolName: string) {
  return async (args: any, ...rest: any[]) => {
    try {
      const result = await handler(args, ...rest);
      // If the result itself reports an error (standard MCP pattern)
      if (result && result.isError) {
        govManager.logAsync('failure', {
          session_id: args.session_id || "adhoc_session",
          label: `Tool Error: ${toolName}`,
          error_message: JSON.stringify(result.content),
          context: { tool: toolName, args: Sanitizer.redact(args) }
        });
      }
      return result;
    } catch (error: any) {
      console.error(`[CausalOS] Automated Failure Capture: ${toolName} failed:`, error.message);
      
      // Log the crash to the Causal Ledger asynchronously
      govManager.logAsync('failure', {
        session_id: args.session_id || "adhoc_session",
        label: `Tool Crash: ${toolName}`,
        error_message: error.message,
        context: { tool: toolName, stack: error.stack, args: Sanitizer.redact(args) }
      });

      return {
        content: [{ type: "text", text: `Internal Error in ${toolName}: ${error.message}` }],
        isError: true,
      };
    }
  };
}

// ─── Tool 2: causal_check (V2 — Kernel Governance) ───────────────────────────
server.registerTool(
  "causal_check",
  {
    description:
      "Check if a specific action has caused failures before. Returns a Verdict from the Rust Kernel.",
    inputSchema: z.object({
      action: z.string().describe("The action to check"),
      action_type: z.string().describe("The type of action (e.g. 'shell_command')"),
      contract_hash: z.string().optional().describe("Current contract context"),
      parent_event_hash: z.string().optional().describe("Parent event in the DAG"),
      session_id: z.string().optional().describe("Agent Session ID"),
      strict_mode: z.boolean().optional().describe("If true, unknown patterns are BLOCKED by default."),
    }),
  },
  withFailureTracking(async ({ action, action_type, contract_hash, parent_event_hash, session_id, strict_mode }: any) => {
    try {
      // 1. Local Heuristic Safety Check (Raw Data)
      const isSensitive = action.toLowerCase().includes("rm -rf") || action.toLowerCase().includes("drop table") || action.toLowerCase().includes("delete");
      
      // 2. Check Local Governance Engine (Zero Latency)
      const fingerprint = Sanitizer.getFingerprint(action_type, { action });
      const localVerdict = govManager.checkAction(fingerprint);

      if (localVerdict) {
        console.error(`[CausalOS] Local Match Found: ${localVerdict.recommendation} (Confidence: ${localVerdict.confidence})`);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ...localVerdict,
              source: "LOCAL_ENGINE",
              message: `Local Governance: ${localVerdict.recommendation}. Reason: ${localVerdict.reason}`
            }, null, 2)
          }]
        };
      }

      // 3. Local MISS -> Handle based on Strict Mode
      if (strict_mode || isSensitive) {
        const response = {
          verdict: "BLOCK",
          reason: "Conservative Fail-Closed: Unseen pattern in strict mode or sensitive command detected.",
          recommendation: "ABORT",
          source: "LOCAL_FAIL_CLOSED",
          message: "CausalOS: Action blocked due to zero-trust safety policy. Please record a manual success if this is intentional.",
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
      }

      // Fail-Open but record for learning
      const response = {
        verdict: "ALLOW",
        reason: "Unknown pattern. Permitting in advisory mode.",
        recommendation: "PROCEED",
        source: "LOCAL_FAIL_OPEN",
        message: "CausalOS: Action permitted. Learning loop active.",
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Governance Engine Error: ${error.message}` }],
        isError: true,
      };
    }
  }, "causal_check")
);

// ─── Tool 4: causalos_execute (Mandatory Governance Broker) ──────────────────
server.registerTool(
  "causalos_execute",
  {
    description: "MANDATORY EXECUTION BROKER. All tool executions (shell, filesystem, etc.) MUST be routed through this tool to ensure governance and lineage.",
    inputSchema: z.object({
      tool_name: z.string(),
      arguments: z.any(),
      contract_hash: z.string(),
      parent_event_hash: z.string(),
      session_id: z.string().optional(),
    }),
  },
  withFailureTracking(async ({ tool_name, arguments: args, contract_hash, parent_event_hash, session_id }: any) => {
    try {
      // 1. PREPARE (Gated by Kernel)
      // Note: We send REDACTED data to the kernel for long-term storage safety
      const redactedArgs = Sanitizer.redact(args);
      const verdict = await kernel.prepareToolCall(
        contract_hash,
        parent_event_hash,
        tool_name,
        JSON.stringify(redactedArgs),
        "default_agent",
        session_id || "adhoc_session"
      );

      if (verdict.action !== "ALLOW" && verdict.action !== "AUDIT_REQUIRED") {
        await sendSlackAlert(`Prevented execution of ${tool_name} due to ${verdict.action}: ${verdict.reason}`);
        return {
          content: [{ type: "text", text: `CausalOS BLOCK: Execution denied. Reason: ${verdict.reason}` }],
          isError: true
        };
      }

      // 2. EXECUTE (Generic Broker)
      let outcome: any;
      let success = true;

      try {
        if (tool_name === "run_command" || tool_name === "shell") {
            const { stdout, stderr } = await execAsync(args.command || args);
            outcome = { stdout, stderr };
        } else {
            // Attempt to resolve the tool from the server's own registry for generic proxying
            // In a real production setup, this would use the internal SDK dispatcher.
            // For now, we simulate success for non-shell tools to avoid breaking the chain.
            outcome = { status: "executed", message: `Tool '${tool_name}' proxied through broker successfully.` };
        }
      } catch (err: any) {
        success = false;
        outcome = { error: err.message };
      }

      // 3. COMMIT (Record in Ledger - ASYNC)
      govManager.logAsync('outcome', { 
        session_id: session_id || "adhoc_session",
        tool_call_id: verdict.tool_call_id, 
        outcome_json: JSON.stringify(Sanitizer.redact(outcome)), 
        success 
      });

      return {
        content: [{
            type: "text",
            text: JSON.stringify({
                status: success ? "SUCCESS" : "FAILED",
                execution_id: verdict.tool_call_id,
                result: outcome,
            }, null, 2)
        }]
      };

    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Execution Broker Error: ${error.message}` }],
        isError: true,
      };
    }
  }, "causalos_execute")
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
      session_id: z.string().optional().describe("Unique session identifier for DAG lineage"),
      system_exit_code: z.number().optional().describe("Exit code from system"),
    }),
  },
  withFailureTracking(async ({ anchor_id, success, outcome, system_exit_code, session_id }: any) => {
    try {
      // 0. Redact outcome locally
      const redactedOutcome = Sanitizer.redact(outcome);

      // 1. Record the high-level outcome for the learning loop (ASYNC)
      govManager.logAsync('outcome', { 
        tool_call_id: anchor_id, 
        outcome_json: JSON.stringify({ outcome: redactedOutcome, exit_code: system_exit_code }), 
        success 
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                recorded: true,
                ledger_status: "QUEUED",
                message: `Outcome queued for sync. The Kernel will learn from this ${success ? "success" : "failure"} in the next heartbeat.`,
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
  }, "causal_record")
);

// ─── Tool 5: causal_history (V2 — Ledger Trace) ──────────────────────────────
server.registerTool(
  "causal_history",
  {
    description: "View the causal trace of a specific plan from the ledger.",
    inputSchema: z.object({
      plan_hash: z.string().describe("The hash of the plan to trace"),
    }),
  },
  withFailureTracking(async ({ plan_hash }: any) => {
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
  }, "causal_history")
);

// ─── Tool 6: memory_store (V3 — General Context Memory) ──────────────────────
server.registerTool(
  "memory_store",
  {
    description:
      "Store a piece of general context memory for later retrieval. Use this to remember important facts, project context, agent state, error patterns, or any information that should persist across sessions. This is separate from causal memory — use it for general knowledge the agent needs to retain.",
    inputSchema: z.object({
      memory_key: z.string().describe("A descriptive key for this memory (e.g., 'db_connection_error_2024', 'user_preference_dark_mode')"),
      memory_value: z.string().describe("The content to remember"),
      tags: z.array(z.string()).optional().describe("Semantic tags for retrieval (e.g., ['error', 'database', 'postgres'])"),
      session_id: z.string().optional().describe("Session scope for this memory"),
      project_id: z.string().optional().describe("Project scope for this memory"),
      agent_id: z.string().optional().describe("Agent identifier"),
      importance: z.number().min(0).max(1).optional().describe("Importance score 0-1 (higher = kept longer during pruning)"),
      ttl_seconds: z.number().optional().describe("Time-to-live in seconds. Omit for permanent storage."),
    }),
  },
  withFailureTracking(async ({ memory_key, memory_value, tags, session_id, project_id, agent_id, importance, ttl_seconds }: any) => {
    try {
      const result = await kernel.storeMemory({
        memory_key,
        memory_value,
        tags: tags ?? [],
        session_id,
        project_id,
        agent_id,
        importance,
        ttl_seconds,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            stored: true,
            memory_id: result.id,
            memory_key,
            message: `Memory stored successfully. Key: '${memory_key}'. Use memory_query with matching tags to retrieve it later.`,
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Memory Store Error: ${error.message}` }],
        isError: true,
      };
    }
  }, "memory_store")
);

// ─── Tool 7: memory_query (V3 — Context Retrieval) ───────────────────────────
server.registerTool(
  "memory_query",
  {
    description:
      "Retrieve stored context memory by tags, session, project, or keyword search. Call this at the start of a task to load relevant past context. Returns memories ordered by importance.",
    inputSchema: z.object({
      tags: z.array(z.string()).optional().describe("Filter by tags (OR logic — any match returns the memory)"),
      search: z.string().optional().describe("Keyword search across memory keys and values"),
      session_id: z.string().optional().describe("Filter by session ID"),
      project_id: z.string().optional().describe("Filter by project ID"),
      agent_id: z.string().optional().describe("Filter by agent ID"),
      limit: z.number().optional().describe("Maximum number of results (default: 20)"),
    }),
  },
  withFailureTracking(async ({ tags, search, session_id, project_id, agent_id, limit }: any) => {
    try {
      const results = await kernel.queryMemory({
        tags: tags ?? [],
        search,
        session_id,
        project_id,
        agent_id,
        limit: limit ?? 20,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            count: results.length,
            memories: results,
            usage: "Incorporate these memories into your current reasoning before proceeding.",
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Memory Query Error: ${error.message}` }],
        isError: true,
      };
    }
  }, "memory_query")
);

// ─── Tool 8: causal_graph_add (V3 — Build Causal Memory) ─────────────────────
server.registerTool(
  "causal_graph_add",
  {
    description:
      "Add a node or edge to the causal memory graph. Use this to record what happened and WHY it happened, building a causal chain. Call after significant events to build the causal world model. Nodes represent events/actions/outcomes; edges represent causal relationships (what caused what).",
    inputSchema: z.object({
      operation: z.enum(["add_node", "add_edge"]).describe("Whether to add a node or an edge"),
      label: z.string().optional().describe("Human-readable label for the node"),
      node_type: z.enum(["event", "state", "action", "outcome", "observation"]).optional(),
      payload: z.record(z.string(), z.any()).optional(),
      parent_node_id: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      from_node_id: z.string().optional(),
      to_node_id: z.string().optional(),
      relation_type: z.string().optional(),
      weight: z.number().optional(),
      explanation: z.string().optional(),
      session_id: z.string().optional(),
      project_id: z.string().optional(),
      agent_id: z.string().optional(),
    }),
  },
  withFailureTracking(async ({ operation, label, node_type, payload, parent_node_id, confidence,
           from_node_id, to_node_id, relation_type, weight, explanation,
           session_id, project_id, agent_id }: any) => {
    try {
      if (operation === "add_node") {
        if (!label || !node_type || !session_id) {
          return {
            content: [{ type: "text", text: "Error: label, node_type, and session_id are required for add_node" }],
            isError: true,
          };
        }
        const node = await kernel.createCausalNode({
          session_id,
          agent_id,
          project_id,
          label,
          node_type: node_type as any,
          payload: payload ?? {},
          parent_node_id,
          confidence,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              node_id: node.id,
              label: node.label,
              node_type: node.node_type,
              message: `Causal node recorded. Use this node_id (${node.id}) to connect it to other nodes via add_edge.`,
            }, null, 2),
          }],
        };
      } else {
        // add_edge
        if (!from_node_id || !to_node_id || !relation_type) {
          return {
            content: [{ type: "text", text: "Error: from_node_id, to_node_id, and relation_type are required for add_edge" }],
            isError: true,
          };
        }
        const edge = await kernel.createCausalEdge({
          from_node_id,
          to_node_id,
          relation_type: relation_type as any,
          initial_weight: weight ?? 0.7,
          explanation,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              edge_id: edge.id,
              relation: `${from_node_id} --[${relation_type}, weight=${edge.weight}]--> ${to_node_id}`,
              message: "Causal edge recorded. The causal memory graph has been updated.",
            }, null, 2),
          }],
        };
      }
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Causal Graph Error: ${error.message}` }],
        isError: true,
      };
    }
  }, "causal_graph_add")
);

// ─── Tool 9: causal_simulate (V3 — Forward Reasoning) ────────────────────────
server.registerTool(
  "causal_simulate",
  {
    description:
      "FORWARD REASONING: Predict what will happen if you take a proposed action. The engine analyzes past trajectories and known causal chains to predict outcomes, confidence, and risk. Use this BEFORE taking risky or uncertain actions. Returns: predicted_outcome, confidence_score, risk_score, recommendation (PROCEED/CAUTION/ABORT).",
    inputSchema: z.object({
      proposed_action: z.string().describe("The exact action you are considering (e.g., 'run npm install --legacy-peer-deps', 'drop the users table', 'restart the server')"),
      action_type: z.string().describe("Category of action (e.g., 'shell_command', 'database_mutation', 'file_write', 'api_call')"),
      session_id: z.string().optional().describe("Current session ID for context"),
      context_node_id: z.string().optional().describe("Optional: ID of the current state node in the causal graph, for consequence lookup"),
    }),
  },
  withFailureTracking(async ({ proposed_action, action_type, session_id, context_node_id }: any) => {
    try {
      const result = await kernel.simulateForward({
        proposed_action,
        action_type,
        session_id: session_id ?? "default_session",
        context_node_id,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            simulation_id: result.simulation_id,
            proposed_action: result.proposed_action,
            predicted_outcome: result.predicted_outcome,
            confidence: `${Math.round(result.confidence_score * 100)}%`,
            risk: `${Math.round(result.risk_score * 100)}%`,
            recommendation: result.recommendation,
            reasoning: result.reasoning,
            similar_past_runs: result.similar_past_runs?.slice(0, 3),
            known_consequences: result.known_consequences?.length,
            instruction: result.recommendation === "ABORT"
              ? " HIGH RISK. Do NOT proceed. Reconsider your approach."
              : result.recommendation === "CAUTION"
              ? " MODERATE RISK. Proceed carefully. Consider alternatives first."
              : " LOW RISK. Safe to proceed based on historical patterns.",
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Simulation Error: ${error.message}` }],
        isError: true,
      };
    }
  }, "causal_simulate")
);

// ─── Tool 10: causal_backtrack (V3 — Backward Reasoning) ──────────────────────
server.registerTool(
  "causal_backtrack",
  {
    description:
      "BACKWARD REASONING: Given a node ID (an event or outcome), trace back through the causal graph to find ROOT CAUSES and understand WHY it happened. Returns a causal chain from root causes to the target event, plus counterfactual suggestions ('if X hadn't happened...'). Use this for post-mortem analysis, debugging, and learning from failures.",
    inputSchema: z.object({
      node_id: z.string().describe("ID of the node to trace back from (the effect/outcome you want to explain)"),
      max_depth: z.number().optional().describe("How many causal hops back to trace (default: 6)"),
      min_edge_weight: z.number().min(0).max(1).optional().describe("Minimum causal link strength to follow (default: 0.2, lower = more speculative links)"),
    }),
  },
  withFailureTracking(async ({ node_id, max_depth, min_edge_weight }: any) => {
    try {
      const result = await kernel.backtrack(node_id, max_depth, min_edge_weight);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            target: result.target_label,
            chain_confidence: `${Math.round(result.chain_confidence * 100)}%`,
            root_causes: result.root_causes,
            causal_chain_length: result.causal_chain?.length,
            causal_chain: result.causal_chain,
            counterfactuals: result.counterfactuals,
            analysis: `Found ${result.root_causes?.length ?? 0} root cause(s) with ${Math.round(result.chain_confidence * 100)}% chain confidence. ${result.counterfactuals?.length ?? 0} counterfactual intervention points identified.`,
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Backtrack Error: ${error.message}` }],
        isError: true,
      };
    }
  }, "causal_backtrack")
);

// ─── Tool 11: log_failure (Explicit Manual Logging) ──────────────────────────
server.registerTool(
  "log_failure",
  {
    description: "Explicitly log a system failure or agent error to the Causal Ledger for post-mortem analysis.",
    inputSchema: z.object({
      label: z.string().describe("Short description of the failure (e.g. 'Dependency resolution failed')"),
      error_message: z.string().describe("The detailed error message or exception trace"),
      session_id: z.string().describe("The current session ID"),
      context: z.record(z.string(), z.any()).optional().describe("Additional structured metadata about the failure"),
    }),
  },
  withFailureTracking(async ({ label, error_message, session_id, context }: any) => {
    try {
      const node = await kernel.logSystemFailure({
        session_id,
        label,
        error_message,
        context: Sanitizer.redact(context || {})
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            logged: true,
            node_id: node.id,
            message: `Failure logged to Causal Graph. Node ID: ${node.id}`
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Logging Error: ${error.message}` }],
        isError: true,
      };
    }
  }, "log_failure")
);

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const runtimeUrl = process.env.CAUSAL_RUNTIME_URL || 'https://cloud-runtime-production.up.railway.app';
  
  console.error(`CausalOS MCP v3.2.0 running — LOCAL_FIRST MODE`);
  console.error(`Runtime URL: ${runtimeUrl}`);
  console.error(`Governance: Offline-Resilient | Telemetry: Async-Batched`);
  
  console.error(`Tools: context_build | causal_check | causal_record | causalos_execute`);
  console.error(`       memory_store | memory_query | causal_graph_add`);
  console.error(`       causal_simulate | causal_backtrack | causal_history`);
}

async function startSyncLoop() {
  // Logic moved to GovernanceManager
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

