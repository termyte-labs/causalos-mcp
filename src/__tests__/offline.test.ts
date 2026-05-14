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

    it("should mark cloud prepare failures as local failsafe blocks", async () => {
        const verdict = await client.prepareToolCall("s1", "execute", { command: "ls" });
        expect(verdict.verdict).toBe("BLOCK");
        expect(verdict.reason).toContain("Cloud governance unavailable");
        expect(verdict.source).toBe("failsafe");
    });

    it("should handle failed commit gracefully", async () => {
        const result = await client.commitToolCall({
            tool_call_id: "tc1",
            outcome: { stdout: "" },
            success: true,
            exit_code: 0
        });
        expect(result.status).toBe("local_only");
    });
});
