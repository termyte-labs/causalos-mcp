import { LRUCache } from 'lru-cache';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Verdict {
    recommendation: 'PROCEED' | 'CAUTION' | 'ABORT';
    reason: string;
    confidence: number;
    risk_score: number;
}

export class HotCache {
    private static cache = new LRUCache<string, Verdict>({
        max: 500,
        ttl: 1000 * 60 * 60, // 1 hour
    });

    /**
     * Retrieves a cached verdict for a given action fingerprint.
     */
    public static get(fingerprint: string): Verdict | undefined {
        return this.cache.get(fingerprint);
    }

    /**
     * Stores a verdict in the local hot cache.
     */
    public static set(fingerprint: string, verdict: Verdict): void {
        this.cache.set(fingerprint, verdict);
    }

    /**
     * Batch updates the cache from a cloud sync payload.
     */
    public static updateFromSync(data: Record<string, Verdict>): void {
        for (const [fingerprint, verdict] of Object.entries(data)) {
            this.cache.set(fingerprint, verdict);
        }
    }

    private static getCachePath(): string {
        const dir = path.join(os.homedir(), '.causalos');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return path.join(dir, 'governance_cache.json');
    }

    public static saveToDisk(): void {
        try {
            const data: Record<string, any> = {};
            // @ts-ignore - access internal cache entries for serialization
            for (const [key, value] of this.cache.dump()) {
                data[key] = value;
            }
            const p = this.getCachePath();
            const tempPath = `${p}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
            fs.renameSync(tempPath, p);
        } catch (err) {
            console.error('[HotCache] Failed to save to disk:', err);
        }
    }

    public static loadFromDisk(): void {
        try {
            const cachePath = this.getCachePath();
            if (fs.existsSync(cachePath)) {
                const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                for (const [key, val] of Object.entries(data)) {
                    this.cache.set(key, val as Verdict);
                }
                console.error(`[HotCache] Loaded ${Object.keys(data).length} patterns from disk.`);
            }
        } catch (err) {
            console.error('[HotCache] Failed to load from disk:', err);
        }
    }
}
