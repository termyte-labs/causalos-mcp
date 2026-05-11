import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { Sanitizer } from './sanitizer.js';

export class CloudKernelClient {
    private deviceId: string | null = null;
    private authToken: string | null = null;
    private orgId: string | null = null;
    private agent: string | null = null;
    private baseURL: string;

    constructor() {
        this.baseURL = process.env.TERMYTE_API_URL || 'https://mcp.termyte.xyz';
    }

    async getDeviceId(): Promise<string> {
        if (this.deviceId) return this.deviceId;

        if (process.env.TERMYTE_DEVICE_ID) {
            this.deviceId = process.env.TERMYTE_DEVICE_ID;
            return this.deviceId;
        }

        const configPath = path.join(os.homedir(), '.termyte', 'config.json');
        try {
            const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
            if (config.device_id) {
                this.deviceId = config.device_id as string;
                return this.deviceId;
            }
        } catch (e) {}

        throw new Error("TERMYTE_DEVICE_ID not found. Run 'npx termyte init' first.");
    }

    private async getConfig(): Promise<any> {
        const configPath = path.join(os.homedir(), '.termyte', 'config.json');
        try {
            return JSON.parse(await fs.readFile(configPath, 'utf-8'));
        } catch (e) {
            return {};
        }
    }

    private async getAuthHeaders(): Promise<Record<string, string>> {
        const deviceId = await this.getDeviceId();
        if (!this.authToken || !this.orgId || !this.agent) {
            const config = await this.getConfig();
            this.authToken = process.env.TERMYTE_AUTH_TOKEN || config.auth_token || null;
            this.orgId = process.env.TERMYTE_ORG_ID || config.org_id || null;
            this.agent = process.env.TERMYTE_AGENT || config.agent || null;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-termyte-device-id': deviceId
        };
        if (this.authToken) headers['x-termyte-auth-token'] = this.authToken;
        if (this.orgId) headers['x-termyte-org-id'] = this.orgId;
        if (this.agent) headers['x-termyte-agent'] = this.agent;
        return headers;
    }

    private async request(method: string, endpoint: string, body?: any): Promise<any> {
        const url = new URL(endpoint, this.baseURL);
        const headers = await this.getAuthHeaders();

        return new Promise((resolve, reject) => {
            const options = {
                method,
                hostname: url.hostname,
                port: url.port,
                path: `${url.pathname}${url.search}`,
                headers,
                timeout: 10000
            };

            const transport = url.protocol === 'https:' ? https : http;
            const req = transport.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(parsed.message || `Server error: ${res.statusCode}`));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        if (res.statusCode === 204) resolve({});
                        else reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', reject);
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    }

    async startDeviceAuth(input: { device_id: string; agent?: string; install_label?: string }) {
        return this.request('POST', '/v1/auth/device/start', input);
    }

    async pollDeviceAuth(device_code: string) {
        return this.request('POST', '/v1/auth/device/poll', { device_code });
    }

    async prepareToolCall(session_id: string, tool_name: string, payload: any) {
        return this.request('POST', '/v1/governance/prepare', {
            session_id,
            tool_name,
            payload_json: Sanitizer.redact(payload),
        });
    }

    async contextBuild(input: {
        task: string;
        cwd?: string;
        project_name?: string;
        agent?: string;
        session_id?: string;
    }) {
        return this.request('POST', '/v1/context/build', Sanitizer.redact(input));
    }

    async guardAction(input: {
        session_id: string;
        action_type: string;
        intent: string;
        payload: any;
        cwd?: string;
        project_name?: string;
    }) {
        return this.request('POST', '/v1/governance/guard', {
            ...input,
            payload: Sanitizer.redact(input.payload),
        });
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
    }) {
        return this.request('POST', '/v1/governance/commit', {
            tool_call_id: params.tool_call_id,
            outcome_json: params.outcome ? Sanitizer.redact(params.outcome) : undefined,
            success: params.success,
            exit_code: params.exit_code,
            command_args: params.command_args ? Sanitizer.redact(params.command_args) : undefined,
            stdout: params.stdout ? Sanitizer.redact(params.stdout) : undefined,
            stderr: params.stderr ? Sanitizer.redact(params.stderr) : undefined,
            duration_ms: params.duration_ms,
            parent_event_hash: params.parent_event_hash
        });
    }

    async getMetrics() {
        return this.request('GET', '/metrics');
    }

    async getTimeline(session_id?: string) {
        const suffix = session_id ? `?session_id=${encodeURIComponent(session_id)}` : '';
        return this.request('GET', `/v1/governance/timeline${suffix}`);
    }
}
