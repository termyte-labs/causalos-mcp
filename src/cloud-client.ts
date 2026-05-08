import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { Sanitizer } from './sanitizer.js';

export class CloudKernelClient {
    private deviceId: string | null = null;
    private baseURL: string;

    constructor() {
        this.baseURL = process.env.TERMYTE_API_URL || 'https://mcp.causalos.xyz';
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

    private async request(method: string, endpoint: string, body?: any): Promise<any> {
        const url = new URL(endpoint, this.baseURL);
        const deviceId = await this.getDeviceId();

        return new Promise((resolve, reject) => {
            const options = {
                method,
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                headers: {
                    'Content-Type': 'application/json',
                    'x-termyte-device-id': deviceId
                },
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

    async prepareToolCall(session_id: string, tool_name: string, payload: any) {
        return this.request('POST', '/v1/governance/prepare', {
            session_id,
            tool_name,
            payload_json: Sanitizer.redact(payload),
        });
    }

    async commitToolCall(tool_call_id: string, outcome: any, success: boolean, exitCode?: number) {
        return this.request('POST', '/v1/governance/commit', {
            tool_call_id,
            outcome_json: outcome,
            success,
            exit_code: exitCode
        });
    }

    async getMetrics() {
        return this.request('GET', '/metrics');
    }
}
