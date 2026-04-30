import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HotCache } from './cache.js';
import type { Verdict } from './cache.js';
import { CloudKernelClient } from './cloud-client.js';

export class GovernanceManager {
    private cloudClient: CloudKernelClient;
    private syncInterval: NodeJS.Timeout | null = null;
    private telemetryBuffer: any[] = [];
    private flushInterval: NodeJS.Timeout | null = null;

    constructor(cloudClient: CloudKernelClient) {
        this.cloudClient = cloudClient;
    }

    private getTelemetryPath(): string {
        const dir = path.join(os.homedir(), '.causalos');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return path.join(dir, 'pending_telemetry.json');
    }

    private saveTelemetryToDisk() {
        try {
            const p = this.getTelemetryPath();
            const tempPath = `${p}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(this.telemetryBuffer, null, 2));
            fs.renameSync(tempPath, p);
        } catch (err) {
            console.error('[GovernanceManager] Failed to save telemetry to disk:', err);
        }
    }

    private loadTelemetryFromDisk() {
        try {
            const p = this.getTelemetryPath();
            if (fs.existsSync(p)) {
                const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (Array.isArray(data)) {
                    this.telemetryBuffer = [...data, ...this.telemetryBuffer];
                    console.error(`[GovernanceManager] Loaded ${data.length} pending telemetry records from disk.`);
                }
            }
        } catch (err) {
            console.error('[GovernanceManager] Failed to load telemetry from disk:', err);
        }
    }

    /**
     * Initializes the governance layer:
     * 1. Loads cache from disk
     * 2. Triggers an initial cloud sync
     * 3. Sets up background telemetry flushing
     */
    public async initialize() {
        console.error('[GovernanceManager] Initializing Local-First Engine...');
        HotCache.loadFromDisk();
        this.loadTelemetryFromDisk();
        
        // Initial Sync (don't await, let it run in background to avoid blocking MCP startup)
        this.syncWithCloud().catch(() => {});

        // Background Sync every 10 minutes
        this.syncInterval = setInterval(() => this.syncWithCloud(), 10 * 60 * 1000);

        // Telemetry flushing every 5 seconds
        this.flushInterval = setInterval(() => this.flushTelemetry(), 5000);
    }

    public async syncWithCloud() {
        try {
            console.error('[GovernanceManager] Syncing failure patterns from Cloud Ledger...');
            const snapshot = await this.cloudClient.getGovernanceSnapshot();
            
            const normalized: Record<string, Verdict> = {};
            for (const [hash, data] of Object.entries(snapshot)) {
                const item = data as any;
                normalized[hash] = {
                    recommendation: item.recommendation === 'BLOCK' ? 'ABORT' : item.recommendation,
                    reason: item.reason,
                    confidence: item.confidence || 0.9,
                    risk_score: item.risk_score || 1.0
                };
            }

            HotCache.updateFromSync(normalized);
            HotCache.saveToDisk();
            console.error(`[GovernanceManager] Sync Complete. ${Object.keys(normalized).length} patterns active.`);
        } catch (err: any) {
            console.error('[GovernanceManager] Sync failed:', err.message);
        }
    }

    /**
     * Synchronous local check. Zero latency.
     */
    public checkAction(fingerprint: string): Verdict | null {
        return HotCache.get(fingerprint) || null;
    }

    /**
     * Push data to telemetry buffer for async upload.
     */
    public logAsync(type: 'outcome' | 'failure', data: any) {
        this.telemetryBuffer.push({ type, data, timestamp: Date.now() });
        this.saveTelemetryToDisk();
        
        // If buffer gets too big, flush immediately
        if (this.telemetryBuffer.length > 50) {
            this.flushTelemetry();
        }
    }

    private async flushTelemetry() {
        if (this.telemetryBuffer.length === 0) return;

        // Take a snapshot of the current buffer to flush
        const batch = [...this.telemetryBuffer];
        this.telemetryBuffer = [];
        this.saveTelemetryToDisk(); // Update disk with empty buffer

        console.error(`[GovernanceManager] Flushing ${batch.length} telemetry records to cloud...`);
        
        const failedRecords: any[] = [];

        for (const record of batch) {
            try {
                if (record.type === 'failure') {
                    await this.cloudClient.logSystemFailure(record.data);
                } else {
                    if (record.data.tool_call_id) {
                        await this.cloudClient.commitToolCall(record.data.tool_call_id, record.data.outcome_json, record.data.success);
                    }
                }
            } catch (err: any) {
                console.error('[GovernanceManager] Telemetry flush error:', err.message);
                failedRecords.push(record);
            }
        }

        if (failedRecords.length > 0) {
            console.error(`[GovernanceManager] ${failedRecords.length} records failed to flush. Re-queueing.`);
            this.telemetryBuffer = [...failedRecords, ...this.telemetryBuffer];
            this.saveTelemetryToDisk();
        }
    }

    public stop() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        if (this.flushInterval) clearInterval(this.flushInterval);
        this.flushTelemetry(); // Final flush attempt
    }
}

