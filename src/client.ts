import { CloudKernelClient } from './cloud-client.js';

/**
 * KernelClient v3.1.0 - Cloud-Heavy Implementation
 * This client routes all governance and memory requests to the CausalOS Cloud Runtime.
 * It replaces the legacy gRPC local sidecar to simplify the user experience (MCP-only).
 */
export class KernelClient {
  public cloudClient: CloudKernelClient;

  constructor() {
    this.cloudClient = new CloudKernelClient();
  }

  // ─── V2: Lifecycle & Planning ─────────────────────────────────────────────

  async evaluatePlan(agent_id: string, project_id: string, plan_text: string): Promise<any> {
    try {
      return await this.cloudClient.evaluatePlan(agent_id, project_id, plan_text);
    } catch (err: any) {
      console.error(`[KernelClient] evaluatePlan failure: ${err.message}. Falling back to LOCAL_ADAPTIVE.`);
      return {
        contract_hash: "offline_" + Date.now(),
        risk_score: 0.5,
        required_invariants: [],
        watchpoints: [],
        message: "CausalOS: Cloud Runtime unreachable. Risk score set to neutral 0.5 — no historical data available."
      };
    }
  }

  async recordOutcome(plan_hash: string, success_criteria: string, success: boolean, details: string, session_id: string): Promise<any> {
    return this.cloudClient.recordOutcome(plan_hash, success_criteria, success, details, session_id);
  }

  // ─── V2: Governance ───────────────────────────────────────────────────────

  async prepareToolCall(
    contract_hash: string,
    parent_event_hash: string,
    tool_name: string,
    arguments_json: string,
    agent_id: string,
    session_id: string
  ): Promise<any> {
    try {
      return await this.cloudClient.prepareToolCall(contract_hash, parent_event_hash, tool_name, arguments_json, agent_id, session_id);
    } catch (err: any) {
      console.error(`[KernelClient] Cloud connection failure: ${err.message}. Failing closed for governance safety.`);
      return {
          action: "SOFT_BLOCK",
          reason: "Cloud Runtime unreachable. Cannot verify governance. Action blocked for safety.",
          tool_call_id: "failsafe_" + Date.now()
      };
    }
  }

  async commitToolCall(tool_call_id: string, outcome_json: string, success: boolean): Promise<any> {
    return this.cloudClient.commitToolCall(tool_call_id, outcome_json, success);
  }

  async getCausalTrace(plan_hash: string): Promise<any> {
    return this.cloudClient.getCausalTrace(plan_hash);
  }

  // ─── V3: Causal Graph ─────────────────────────────────────────────────────

  async createCausalNode(params: Parameters<CloudKernelClient['createCausalNode']>[0]): Promise<any> {
    return this.cloudClient.createCausalNode(params);
  }

  async createCausalEdge(params: Parameters<CloudKernelClient['createCausalEdge']>[0]): Promise<any> {
    return this.cloudClient.createCausalEdge(params);
  }

  async getSessionGraph(session_id: string): Promise<any> {
    return this.cloudClient.getSessionGraph(session_id);
  }

  async backtrack(node_id: string, max_depth?: number, min_weight?: number): Promise<any> {
    return this.cloudClient.backtrack(node_id, max_depth, min_weight);
  }

  // ─── V3: Forward Simulation ───────────────────────────────────────────────

  async simulateForward(params: Parameters<CloudKernelClient['simulateForward']>[0]): Promise<any> {
    return this.cloudClient.simulateForward(params);
  }

  // ─── V3: General Memory ───────────────────────────────────────────────────

  async storeMemory(params: Parameters<CloudKernelClient['storeMemory']>[0]): Promise<any> {
    return this.cloudClient.storeMemory(params);
  }

  async queryMemory(params: Parameters<CloudKernelClient['queryMemory']>[0]): Promise<any> {
    return this.cloudClient.queryMemory(params);
  }

  async deleteMemory(key: string, agent_id?: string): Promise<any> {
    return this.cloudClient.deleteMemory(key, agent_id);
  }

  async logSystemFailure(params: Parameters<CloudKernelClient['logSystemFailure']>[0]): Promise<any> {
    return this.cloudClient.logSystemFailure(params);
  }

  async getGovernanceSnapshot(): Promise<any> {
    return this.cloudClient.getGovernanceSnapshot();
  }
}

export const kernel = new KernelClient();
