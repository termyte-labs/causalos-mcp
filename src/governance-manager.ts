import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HotCache } from './cache.js';
import type { Verdict } from './cache.js';
import { CloudKernelClient } from './cloud-client.js';
import { Sanitizer } from './sanitizer.js';

function logJson(level: 'info' | 'error', event: string, fields: Record<string, unknown> = {}) {
    console.error(JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields }));
}

export class GovernanceManager {
    private cloudClient: CloudKernelClient;
    private syncInterval: NodeJS.Timeout | null = null;
    private telemetryBuffer: any[] = [];
    private flushInterval: NodeJS.Timeout | null = null;

    constructor(cloudClient: CloudKernelClient) {
        this.cloudClient = cloudClient;
    }

    private getTelemetryPath(sessionId?: string): string {
        const dir = path.join(os.homedir(), '.causalos', 'telemetry');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const safeSessionId = (sessionId || 'global').replace(/[^a-z0-9]/gi, '_');
        return path.join(dir, `pending_${safeSessionId}.json`);
    }

    private saveTelemetryToDisk(sessionId?: string) {
        try {
            const p = this.getTelemetryPath(sessionId);
            const tempPath = `${p}.tmp`;
            
            // For a specific session, we only want to write its slice to its own file
            const sessionData = this.telemetryBuffer.filter(t => 
                t.data && t.data.session_id === sessionId
            );
            
            if (sessionData.length === 0 && sessionId) return;

            fs.writeFileSync(tempPath, JSON.stringify(sessionId ? sessionData : this.telemetryBuffer, null, 2));
            fs.renameSync(tempPath, p);
        } catch (err) {
            logJson('error', 'telemetry_save_failed', { message: String(err) });
        }
    }

    private loadTelemetryFromDisk() {
        try {
            const dir = path.join(os.homedir(), '.causalos', 'telemetry');
            if (!fs.existsSync(dir)) return;

            const files = fs.readdirSync(dir).filter(f => f.startsWith('pending_') && f.endsWith('.json'));
            for (const file of files) {
                const p = path.join(dir, file);
                try {
                    const content = fs.readFileSync(p, 'utf8');
                    if (!content) {
                        fs.unlinkSync(p);
                        continue;
                    }
                    const data = JSON.parse(content);
                    if (Array.isArray(data)) {
                        this.telemetryBuffer = [...this.telemetryBuffer, ...data];
                    }
                    fs.unlinkSync(p); // Delete after successful load
                } catch (e) {
                    // If file is corrupt, move it to .bak or delete
                    logJson('error', 'telemetry_corrupt_file_removed', { file, message: String(e) });
                    fs.unlinkSync(p);
                }
            }
            if (this.telemetryBuffer.length > 0) {
                this.saveTelemetryToDisk(); // Consolidate into global file
                logJson('info', 'telemetry_recovered', { count: this.telemetryBuffer.length });
            }
        } catch (err) {
            logJson('error', 'telemetry_load_failed', { message: String(err) });
        }
    }

    /**
     * Initializes the governance layer:
     * 1. Loads cache from disk
     * 2. Triggers an initial cloud sync
     * 3. Sets up background telemetry flushing
     */
    public async initialize() {
        logJson('info', 'governance_initialize');
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
            logJson('info', 'governance_sync_start');
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
            logJson('info', 'governance_sync_complete', { patterns: Object.keys(normalized).length });
        } catch (err: any) {
            logJson('error', 'governance_sync_failed', { message: err.message });
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
     * Error messages are redacted before being stored to prevent secrets from
     * leaking into the ~/.causalos/telemetry/ files on disk.
     */
    public logAsync(type: 'outcome' | 'failure', data: any) {
        const safeData = type === 'failure' && data.error_message
            ? { ...data, error_message: Sanitizer.redact(String(data.error_message)) }
            : data;
        this.telemetryBuffer.push({ type, data: safeData, timestamp: Date.now() });
        this.saveTelemetryToDisk(safeData.session_id);
        
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
        
        // We don't call saveTelemetryToDisk() yet to avoid writing an empty file 
        // if we are about to re-queue failures anyway.

        logJson('info', 'telemetry_flush_start', { count: batch.length });
        
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
                logJson('error', 'telemetry_flush_record_failed', { type: record.type, message: err.message });
                failedRecords.push(record);
            }
        }

        if (failedRecords.length > 0) {
            logJson('error', 'telemetry_flush_requeued', { count: failedRecords.length });
            this.telemetryBuffer = [...failedRecords, ...this.telemetryBuffer];
        }
        
        // Always sync the final state (empty or with failures) back to disk
        this.saveTelemetryToDisk();
    }

    public stop() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        if (this.flushInterval) clearInterval(this.flushInterval);
        this.flushTelemetry(); // Final flush attempt
    }
}

