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

export class KernelClient {
  private client: any;

  constructor(address = process.env.CAUSAL_RUNTIME_HOST || 'localhost:50051') {
    this.client = new kernelNamespace.KernelService(
      address,
      grpc.credentials.createInsecure()
    );
  }

  // 1. Lifecycle & Planning
  async evaluatePlan(agent_id: string, project_id: string, plan_text: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.EvaluatePlan({ agent_id, project_id, plan_text }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  async recordOutcome(plan_hash: string, success_criteria: string, success: boolean, details: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.RecordOutcome({ plan_hash, success_criteria, success, details }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  // 2. Governance
  async prepareToolCall(tool_name: string, arguments_json: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.PrepareToolCall({ tool_name, arguments_json }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  async commitToolCall(tool_call_id: string, outcome_json: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.CommitToolCall({ tool_call_id, outcome_json }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  async getCausalTrace(plan_hash: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.GetCausalTrace({ plan_hash }, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }
}

export const kernel = new KernelClient();
