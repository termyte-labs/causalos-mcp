import axios from 'axios';

const CLOUD_URL = process.env.CAUSAL_RUNTIME_URL || 'https://cloud-runtime-production.up.railway.app';
const API_KEY = process.env.CAUSAL_API_KEY;

export class CloudKernelClient {
    private client;

    constructor() {
        console.error(`[CloudKernelClient] Initialized with URL: ${CLOUD_URL}`);
        if (!API_KEY) {
            console.error(`[CloudKernelClient] WARNING: No CAUSAL_API_KEY found in environment.`);
        }
        
        this.client = axios.create({
            baseURL: CLOUD_URL,
            headers: {
                'Authorization': `Bearer ${API_KEY || 'DEV_BYPASS'}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // Increased to 15s for cloud reliability
        });
    }

    // ─── V2 Governance ────────────────────────────────────────────────────────

    async evaluatePlan(agent_id: string, project_id: string, plan_text: string) {
        const resp = await this.client.post('/v1/evaluate', { agent_id, project_id, plan_text });
        return resp.data;
    }

    async recordOutcome(plan_hash: string, success_criteria: string, success: boolean, details: string, session_id: string) {
        const resp = await this.client.post('/v1/record', { 
            plan_hash, 
            success_criteria, 
            success: !!success, 
            details: details || "", 
            session_id 
        });
        return resp.data;
    }

    async prepareToolCall(contract_hash: string, parent_event_hash: string, tool_name: string, arguments_json: string, agent_id: string, session_id: string) {
        const payload = typeof arguments_json === 'string' ? JSON.parse(arguments_json || '{}') : arguments_json;
        const resp = await this.client.post('/v1/prepare', {
            contract_hash: contract_hash || "root",
            parent_event_hash: parent_event_hash || "init",
            tool_name,
            command: tool_name,
            payload_json: payload,
            agent_id: agent_id || "default",
            session_id: session_id || "global"
        }, { timeout: 10000 }); // 10s timeout for prepare
        return resp.data;
    }

    async commitToolCall(tool_call_id: string, outcome_json: string, success: boolean) {
        const outcome = typeof outcome_json === 'string' ? JSON.parse(outcome_json || '{}') : outcome_json;
        const resp = await this.client.post('/v1/commit', { 
            tool_call_id, 
            outcome_json: outcome, 
            success: !!success 
        });
        return resp.data;
    }


    async getCausalTrace(plan_hash: string) {
        const resp = await this.client.get(`/v1/trace/${plan_hash}`);
        return resp.data;
    }

    // ─── V3 Causal Graph ──────────────────────────────────────────────────────

    async createCausalNode(params: {
        session_id: string;
        agent_id?: string;
        project_id?: string;
        label: string;
        node_type: 'event' | 'state' | 'action' | 'outcome' | 'observation';
        payload?: Record<string, unknown>;
        parent_node_id?: string;
        confidence?: number;
    }) {
        const resp = await this.client.post('/v1/graph/node', params);
        return resp.data;
    }

    async createCausalEdge(params: {
        from_node_id: string;
        to_node_id: string;
        relation_type: 'caused' | 'led_to' | 'depends_on' | 'prevented' | 'enabled' | 'correlated';
        initial_weight?: number;
        explanation?: string;
    }) {
        const resp = await this.client.post('/v1/graph/edge', params);
        return resp.data;
    }

    async getSessionGraph(session_id: string) {
        const resp = await this.client.get(`/v1/graph/session/${session_id}`);
        return resp.data;
    }

    async backtrack(node_id: string, max_depth?: number, min_weight?: number) {
        const params = new URLSearchParams();
        if (max_depth !== undefined) params.set('max_depth', String(max_depth));
        if (min_weight !== undefined) params.set('min_weight', String(min_weight));
        const resp = await this.client.get(`/v1/graph/backtrack/${node_id}?${params}`);
        return resp.data;
    }

    // ─── V3 Forward Simulation ────────────────────────────────────────────────

    async simulateForward(params: {
        session_id: string;
        proposed_action: string;
        action_type: string;
        context_node_id?: string;
    }) {
        const resp = await this.client.post('/v1/simulate', params);
        return resp.data;
    }

    // ─── V3 General Memory ────────────────────────────────────────────────────

    async storeMemory(params: {
        session_id?: string;
        project_id?: string;
        agent_id?: string;
        memory_key: string;
        memory_value: string;
        tags?: string[];
        importance?: number;
        ttl_seconds?: number;
    }) {
        const resp = await this.client.post('/v1/memory', params);
        return resp.data;
    }

    async queryMemory(params: {
        agent_id?: string;
        session_id?: string;
        project_id?: string;
        tags?: string[];
        search?: string;
        limit?: number;
    }) {
        const resp = await this.client.post('/v1/memory/query', params);
        return resp.data;
    }

    async deleteMemory(key: string, agent_id?: string) {
        const resp = await this.client.delete(`/v1/memory/${encodeURIComponent(key)}`, {
            params: { agent_id }
        });
        return resp.data;
    }
}
