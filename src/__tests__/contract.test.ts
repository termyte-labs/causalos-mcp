import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { CloudKernelClient } from "../cloud-client.js";

let server: http.Server;
let baseUrl = "";
const requests: any[] = [];

describe("Cloud contract", () => {
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const chunks: any[] = [];
            req.on("data", (d) => chunks.push(d));
            req.on("end", () => {
                const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {};
                requests.push({ url: req.url || "", body, method: req.method });
                res.setHeader("content-type", "application/json");
                if ((req.url || "").startsWith("/v1/governance/prepare")) {
                    res.end(JSON.stringify({ verdict: "ALLOW", reason: "ok", tool_call_id: "tc_1" }));
                } else if ((req.url || "").startsWith("/v1/governance/commit")) {
                    res.end(JSON.stringify({ status: "success" }));
                } else {
                    res.end(JSON.stringify({ ok: true }));
                }
            });
        });

        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", () => resolve());
        });

        const addr = server.address();
        if (addr && typeof addr === "object") {
            baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        
        // Mock environment variables
        process.env.TERMYTE_API_URL = baseUrl;
        process.env.TERMYTE_DEVICE_ID = "test-device-id";
    });

    beforeEach(() => {
        requests.length = 0;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("prepareToolCall calls /v1/governance/prepare with correct payload", async () => {
        const client = new CloudKernelClient();
        const payload = { command: "ls" };
        await client.prepareToolCall("session-1", "execute", payload);

        expect(requests[0]?.url).toBe("/v1/governance/prepare");
        expect(requests[0]?.method).toBe("POST");
        expect(requests[0]?.body).toMatchObject({
            session_id: "session-1",
            tool_name: "execute",
            payload_json: payload,
        });
    });

    it("commitToolCall calls /v1/governance/commit with correct payload", async () => {
        const client = new CloudKernelClient();
        const outcome = { stdout: "ok" };
        await client.commitToolCall("tc_1", outcome, true, 0);

        expect(requests[0]?.url).toBe("/v1/governance/commit");
        expect(requests[0]?.method).toBe("POST");
        expect(requests[0]?.body).toMatchObject({
            tool_call_id: "tc_1",
            outcome_json: outcome,
            success: true,
            exit_code: 0
        });
    });
});
