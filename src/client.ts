import { CloudKernelClient } from './cloud-client.js';

export class KernelClient {
  public cloudClient: CloudKernelClient;

  constructor() {
    this.cloudClient = new CloudKernelClient();
  }

  async prepareToolCall(
    session_id: string,
    tool_name: string,
    payload: any
  ): Promise<any> {
    try {
      return await this.cloudClient.prepareToolCall(session_id, tool_name, payload);
    } catch (err: any) {
      console.error(`[KernelClient] Governance failure: ${err.message}. Failing closed.`);
      return {
          verdict: "BLOCK",
          reason: "Governance runtime unreachable. Action blocked for safety.",
          source: "failsafe"
      };
    }
  }

  async contextBuild(input: {
    task: string;
    cwd?: string;
    project_name?: string;
    agent?: string;
    session_id?: string;
  }): Promise<any> {
    try {
      return await this.cloudClient.contextBuild(input);
    } catch (err: any) {
      console.error(`[KernelClient] Context build failed: ${err.message}`);
      return {
        session_id: input.session_id,
        instruction_patch: "Termyte context is unavailable. Continue carefully and call guard_action before risky actions.",
        relevant_failures: [],
        constraints: [],
        source: "failsafe"
      };
    }
  }

  async guardAction(input: {
    session_id: string;
    action_type: string;
    intent: string;
    payload: any;
    cwd?: string;
    project_name?: string;
  }): Promise<any> {
    try {
      return await this.cloudClient.guardAction(input);
    } catch (err: any) {
      console.error(`[KernelClient] Guard action failed: ${err.message}. Failing closed.`);
      return {
        verdict: "BLOCK",
        reason: "Governance runtime unreachable. Action blocked for safety.",
        risk_score: 1,
        matched_patterns: [],
        alternative: "Retry after Termyte is reachable, or ask the user for explicit approval.",
        source: "failsafe"
      };
    }
  }

  async commitToolCall(params: {
    tool_call_id: string;
    outcome?: any;
    success: boolean;
    exit_code?: number;
    command_args?: any;
    stdout?: string;
    stderr?: string;
    duration_ms?: number;
    parent_event_hash?: string | null;
  }): Promise<any> {
    try {
        return await this.cloudClient.commitToolCall(params);
    } catch (err) {
        // Log locally if cloud is down, but don't crash
        console.error(`[KernelClient] Failed to commit outcome: ${err}`);
        return { status: "local_only" };
    }
  }
}

export const kernel = new KernelClient();
