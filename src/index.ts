import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const CAUSALOS_PORT = process.env.CAUSALOS_PORT || "7433";
const CAUSALOS_BASE_URL = `http://localhost:${CAUSALOS_PORT}`;

const server = new McpServer({
  name: "causalos-mcp",
  version: "0.1.0",
});

// Helper for calling the causal-os backend
async function callBackend(endpoint: string, method: string, body?: any) {
  try {
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${CAUSALOS_BASE_URL}${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`Backend error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error calling causal-os: ${error}`);
    return null;
  }
}

// Tool 1: causal_check
server.registerTool(
  "causal_check",
  {
    description: "Check if a dangerous action has caused failures before",
    inputSchema: z.object({
      action: z.string().describe("The action about to be taken"),
      action_type: z.enum(["DB_DELETE", "DB_WRITE", "FILE_DELETE", "FILE_WRITE", "SHELL", "API_CALL", "NETWORK", "OTHER"]).describe("The type of action"),
      context: z.string().optional().describe("Any relevant context about the current environment"),
    }),
  },
  async ({ action, action_type, context }) => {
    const results = await callBackend("/recall", "POST", {
      action_detail: action,
      top_k: 5,
      threshold: 0.6,
    });

    if (!results || !Array.isArray(results) || results.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            risk_score: 0.0,
            risk_level: "NONE",
            similar_incidents: [],
            recommendation: "PROCEED",
            message: "No similar incidents found in causal memory.",
          }, null, 2)
        }]
      };
    }

    // Calculate risk based on similar incidents
    const maxSeverity = results.reduce((max, rec) => {
      const severities = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
      return severities.indexOf(rec.severity) > severities.indexOf(max) ? rec.severity : max;
    }, "NONE");

    const riskScore = results.length > 0 ? (results.length * 0.2) + (maxSeverity === "CRITICAL" ? 0.5 : maxSeverity === "HIGH" ? 0.3 : 0.1) : 0;
    const clampedScore = Math.min(riskScore, 1.0);

    let recommendation = "PROCEED";
    if (maxSeverity === "CRITICAL" || maxSeverity === "HIGH") recommendation = "BLOCK";
    else if (maxSeverity === "MEDIUM") recommendation = "WARN";

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          risk_score: clampedScore,
          risk_level: maxSeverity,
          similar_incidents: results.map(r => ({
            action: r.action_detail,
            outcome: r.outcome,
            severity: r.severity,
            session_id: r.session_id,
            timestamp: r.timestamp,
          })),
          recommendation,
          message: `Found ${results.length} similar incidents in history. Maximum severity: ${maxSeverity}.`,
        }, null, 2)
      }]
    };
  }
);

// Tool 2: causal_record
server.registerTool(
  "causal_record",
  {
    description: "Record what happened after an action",
    inputSchema: z.object({
      action: z.string().describe("What was executed"),
      action_type: z.enum(["DB_DELETE", "DB_WRITE", "FILE_DELETE", "FILE_WRITE", "SHELL", "API_CALL", "NETWORK", "OTHER"]).describe("The type of action"),
      intent: z.string().describe("Why the agent did this"),
      outcome: z.string().describe("What actually happened"),
      severity: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).describe("Severity of the outcome"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    }),
  },
  async ({ action, action_type, intent, outcome, severity, tags }) => {
    const result = await callBackend("/record", "POST", {
      action_type,
      action_detail: action,
      outcome,
      intent,
      severity,
      tags,
    });

    if (!result) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            record_id: "error",
            recorded: false,
            message: "Failed to connect to CausalOS server.",
          }, null, 2)
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          record_id: result.id || "unknown",
          recorded: true,
          message: "Recorded to causal memory",
        }, null, 2)
      }]
    };
  }
);

// Tool 3: causal_history
server.registerTool(
  "causal_history",
  {
    description: "View the full causal history of a session",
    inputSchema: z.object({
      session_id: z.string().optional().describe("Defaults to current session"),
      limit: z.number().optional().describe("Max records to return, default 20"),
      severity_filter: z.string().optional().describe("Only return records at or above this severity"),
    }),
  },
  async ({ session_id, limit = 20, severity_filter }) => {
    const results = await callBackend(`/history${session_id ? `?session_id=${session_id}` : ""}`, "GET");

    if (!results) {
      return {
        content: [{ type: "text", text: "Failed to retrieve history." }],
        isError: true,
      };
    }

    const records = Array.isArray(results) ? results : [];
    const filteredRecords = severity_filter 
      ? records.filter(r => {
          const severities = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
          return severities.indexOf(r.severity) >= severities.indexOf(severity_filter);
        })
      : records;

    const limitedRecords = filteredRecords.slice(0, limit);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          session_id: session_id || "all",
          records: limitedRecords.map(r => ({
            record_id: r.id,
            action: r.action_detail,
            outcome: r.outcome,
            severity: r.severity,
            timestamp: r.timestamp,
          })),
          total_count: filteredRecords.length,
          critical_count: filteredRecords.filter(r => r.severity === "CRITICAL").length,
        }, null, 2)
      }]
    };
  }
);

// Tool 4: causal_append_downstream
server.registerTool(
  "causal_append_downstream",
  {
    description: "Add downstream effects to a past record",
    inputSchema: z.object({
      record_id: z.string().describe("The original record to append to"),
      downstream_effect: z.string().describe("What additional consequence was discovered"),
      severity: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).describe("Severity of this downstream effect"),
    }),
  },
  async ({ record_id, downstream_effect, severity }) => {
    const result = await callBackend("/append", "POST", {
      record_id,
      description: downstream_effect,
      severity,
    });

    if (!result) {
      return {
        content: [{ type: "text", text: "Failed to append downstream effect." }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          updated: true,
          record_id,
        }, null, 2)
      }]
    };
  }
);

// Tool 5: causal_graph
server.registerTool(
  "causal_graph",
  {
    description: "Query the causal graph",
    inputSchema: z.object({
      agent_id: z.string().optional().describe("Defaults to current agent"),
      format: z.enum(["summary", "full"]).optional().describe("Format of the output"),
    }),
  },
  async ({ agent_id, format = "summary" }) => {
    const results = await callBackend("/graph", "GET");

    if (!results || !Array.isArray(results)) {
      return {
        content: [{ type: "text", text: "Failed to retrieve graph." }],
        isError: true,
      };
    }

    if (format === "full") {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(results, null, 2)
        }]
      };
    }

    const criticalIncidents = results.filter(r => r.severity === "CRITICAL");
    const actionTypes = results.map(r => r.action_type);
    const mostCommonActions = [...new Set(actionTypes)].sort((a, b) => 
      actionTypes.filter(v => v === b).length - actionTypes.filter(v => v === a).length
    ).slice(0, 3);

    const recentCritical = criticalIncidents.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          total_records: results.length,
          critical_incidents: criticalIncidents.length,
          most_common_actions: mostCommonActions,
          recent_critical: recentCritical ? {
            action: recentCritical.action_detail,
            outcome: recentCritical.outcome,
            timestamp: recentCritical.timestamp,
          } : null,
          risk_profile: results.length > 20 && criticalIncidents.length > 2 ? "HIGH" : results.length > 5 ? "MEDIUM" : "LOW",
        }, null, 2)
      }]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CausalOS MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
