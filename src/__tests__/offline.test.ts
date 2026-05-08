import { describe, it, expect, vi, beforeEach } from "vitest";
import { KernelClient } from "../client.js";

describe("Offline Resilience", () => {
    let client: KernelClient;

    beforeEach(() => {
        client = new KernelClient();
        // Mock cloudClient to throw error (simulating network down)
        vi.spyOn(client.cloudClient, 'prepareToolCall').mockRejectedValue(new Error("Network Down"));
        vi.spyOn(client.cloudClient, 'commitToolCall').mockRejectedValue(new Error("Network Down"));
    });

    it("should implement fail-closed in KernelClient for prepareToolCall", async () => {
        // Based on the current client.ts implementation, it fails closed (BLOCK)
        const verdict = await client.prepareToolCall("s1", "execute", { command: "ls" });
        expect(verdict.verdict).toBe("BLOCK");
        expect(verdict.reason).toContain("Governance runtime unreachable");
    });

    it("should handle failed commit gracefully", async () => {
        const result = await client.commitToolCall("tc1", { stdout: "" }, true, 0);
        expect(result.status).toBe("local_only");
    });
});
