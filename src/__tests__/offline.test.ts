import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GovernanceManager } from '../governance-manager.js';
import { HotCache } from '../cache.js';
import { kernel } from '../client.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Offline Resilience', () => {
    let govManager: GovernanceManager;

    beforeEach(() => {
        vi.clearAllMocks();
        // Clear HotCache
        // @ts-ignore
        HotCache.cache.clear();
        govManager = new GovernanceManager(kernel.cloudClient);
    });

    it('should fall back to local check when cloud is unreachable', async () => {
        // Pre-seed HotCache with a block pattern
        const blockFingerprint = 'shell_command:rm -rf /';
        HotCache.set(blockFingerprint, {
            recommendation: 'ABORT',
            reason: 'Simulated dangerous command',
            confidence: 1.0,
            risk_score: 1.0
        });

        const verdict = govManager.checkAction(blockFingerprint);
        expect(verdict?.recommendation).toBe('ABORT');
        expect(verdict?.reason).toBe('Simulated dangerous command');
    });

    it('should permit unknown actions (Fail-Open) when no local pattern exists', async () => {
        const unknownFingerprint = 'shell_command:ls -la';
        const verdict = govManager.checkAction(unknownFingerprint);
        expect(verdict).toBeNull(); // null means it should proceed to Fail-Open logic in index.ts
    });

    it('should implement fail-safe in KernelClient for evaluatePlan', async () => {
        vi.spyOn(kernel.cloudClient, 'evaluatePlan').mockRejectedValue(new Error('Network Down'));

        const plan = await kernel.evaluatePlan('agent1', 'proj1', 'some task');
        expect(plan.contract_hash).toContain('offline_');
        expect(plan.message).toContain('Cloud Runtime unreachable');
    });

    it('should implement fail-open in KernelClient for prepareToolCall', async () => {
        vi.spyOn(kernel.cloudClient, 'prepareToolCall').mockRejectedValue(new Error('Network Down'));

        const verdict = await kernel.prepareToolCall('hash', 'parent', 'tool', '{}', 'agent', 'session');
        expect(verdict.action).toBe('ALLOW');
        expect(verdict.tool_call_id).toContain('failsafe_');
    });

    it('should persist telemetry to disk when cloud is down', async () => {
        vi.spyOn(kernel.cloudClient, 'logSystemFailure').mockRejectedValue(new Error('Network Down'));
        
        const telemetryPath = path.join(os.homedir(), '.causalos', 'pending_telemetry.json');
        if (fs.existsSync(telemetryPath)) fs.unlinkSync(telemetryPath);

        govManager.logAsync('failure', { session_id: 's1', label: 'L1', error_message: 'E1' });
        
        expect(fs.existsSync(telemetryPath)).toBe(true);
        const data = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
        expect(data.length).toBe(1);
        expect(data[0].data.label).toBe('L1');
    });
});
