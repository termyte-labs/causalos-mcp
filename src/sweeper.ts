import { getExpiredPendingAnchors } from "./db.js";
import { expireTimedOutAnchor } from "./anchors.js";

const SWEEP_INTERVAL_MS = 8_000; // 8 seconds

/**
 * Background TTL sweeper.
 *
 * Runs every 8 seconds. Finds all PENDING anchors where expires_at < now()
 * and marks them as EXPIRED → INFERRED_FAILURE (confidence 0.7).
 *
 * This handles the case where an agent never calls causal_record at all
 * (crash, hang, or the agent simply ignored the instructions).
 */
export function startSweeper(): void {
  setInterval(() => {
    const now = Date.now();
    const expired = getExpiredPendingAnchors(now);

    for (const anchor of expired) {
      try {
        expireTimedOutAnchor(anchor.anchor_id, anchor.session_id, anchor.task);
      } catch {
        // Swallow errors — don't crash the MCP server over a sweeper failure
      }
    }
  }, SWEEP_INTERVAL_MS);
}
