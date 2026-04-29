import { LRUCache } from 'lru-cache';

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
}
