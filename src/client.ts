import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.resolve(__dirname, '../proto/kernel.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const causalosProto = grpc.loadPackageDefinition(packageDefinition) as any;
const kernelNamespace = causalosProto.causalos.kernel;

import { CloudKernelClient } from './cloud-client.js';

export class KernelClient {
  private localClient: any;
  private cloudClient: CloudKernelClient | null = null;
  private isCloud = false;

  constructor(address = process.env.CAUSAL_RUNTIME_HOST || 'localhost:50051') {
    if (process.env.CAUSAL_API_KEY) {
      this.cloudClient = new CloudKernelClient();
      this.isCloud = true;
    } else {
      this.localClient = new kernelNamespace.KernelService(
        address,
        grpc.credentials.createInsecure()
      );
    }
  }

  // ─── V2: Lifecycle & Planning ─────────────────────────────────────────────

  async evaluatePlan(agent_id: string, project_id: string, plan_text: string): Promise<any> {
    if (this.isCloud) return this.cloudClient!.evaluatePlan(agent_id, project_id, plan_text);
    return new Promise((resolve, reject) => {
      this.localClient.EvaluatePlan({ agent_id, project_id, plan_text }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  async recordOutcome(plan_hash: string, success_criteria: string, success: boolean, details: string, session_id: string): Promise<any> {
    if (this.isCloud) return this.cloudClient!.recordOutcome(plan_hash, success_criteria, success, details, session_id);
    return new Promise((resolve, reject) => {
      this.localClient.RecordOutcome({ plan_hash, success_criteria, success, details, session_id }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
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
    if (this.isCloud) {
      try {
        return await this.cloudClient!.prepareToolCall(contract_hash, parent_event_hash, tool_name, arguments_json, agent_id, session_id);
      } catch (err) {
        console.error("Cloud kernel timeout. Failing over to SOFT_BLOCK.");
        return { action: "SOFT_BLOCK", reason: "Cloud connection timeout. Safety check skipped.", tool_call_id: "failsafe_" + Date.now() };
      }
    }
    return new Promise((resolve, reject) => {
      this.localClient.PrepareToolCall(
        { contract_hash, parent_event_hash, tool_name, arguments_json, agent_id, session_id },
        (err: any, response: any) => {
          if (err) return reject(err);
          resolve(response);
        }
      );
    });
  }

  async commitToolCall(tool_call_id: string, outcome_json: string, success: boolean): Promise<any> {
    if (this.isCloud) return this.cloudClient!.commitToolCall(tool_call_id, outcome_json, success);
    return new Promise((resolve, reject) => {
      this.localClient.CommitToolCall({ tool_call_id, outcome_json, success }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  async getCausalTrace(plan_hash: string): Promise<any> {
    if (this.isCloud) return this.cloudClient!.getCausalTrace(plan_hash);
    return new Promise((resolve, reject) => {
      this.localClient.GetCausalTrace({ plan_hash }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  // ─── V3: Causal Graph ─────────────────────────────────────────────────────

  async createCausalNode(params: Parameters<CloudKernelClient['createCausalNode']>[0]): Promise<any> {
    if (this.isCloud) return this.cloudClient!.createCausalNode(params);
    throw new Error("createCausalNode requires CAUSAL_API_KEY (cloud mode). Set CAUSAL_API_KEY in your environment.");
  }

  async createCausalEdge(params: Parameters<CloudKernelClient['createCausalEdge']>[0]): Promise<any> {
    if (this.isCloud) return this.cloudClient!.createCausalEdge(params);
    throw new Error("createCausalEdge requires CAUSAL_API_KEY (cloud mode).");
  }

  async getSessionGraph(session_id: string): Promise<any> {
    if (this.isCloud) return this.cloudClient!.getSessionGraph(session_id);
    throw new Error("getSessionGraph requires CAUSAL_API_KEY (cloud mode).");
  }

  async backtrack(node_id: string, max_depth?: number, min_weight?: number): Promise<any> {
    if (this.isCloud) return this.cloudClient!.backtrack(node_id, max_depth, min_weight);
    throw new Error("backtrack requires CAUSAL_API_KEY (cloud mode).");
  }

  // ─── V3: Forward Simulation ───────────────────────────────────────────────

  async simulateForward(params: Parameters<CloudKernelClient['simulateForward']>[0]): Promise<any> {
    if (this.isCloud) return this.cloudClient!.simulateForward(params);
    throw new Error("simulateForward requires CAUSAL_API_KEY (cloud mode).");
  }

  // ─── V3: General Memory ───────────────────────────────────────────────────

  async storeMemory(params: Parameters<CloudKernelClient['storeMemory']>[0]): Promise<any> {
    if (this.isCloud) return this.cloudClient!.storeMemory(params);
    throw new Error("storeMemory requires CAUSAL_API_KEY (cloud mode).");
  }

  async queryMemory(params: Parameters<CloudKernelClient['queryMemory']>[0]): Promise<any> {
    if (this.isCloud) return this.cloudClient!.queryMemory(params);
    throw new Error("queryMemory requires CAUSAL_API_KEY (cloud mode).");
  }

  async deleteMemory(key: string, agent_id?: string): Promise<any> {
    if (this.isCloud) return this.cloudClient!.deleteMemory(key, agent_id);
    throw new Error("deleteMemory requires CAUSAL_API_KEY (cloud mode).");
  }
}

export const kernel = new KernelClient();
