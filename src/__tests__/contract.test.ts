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
                requests.push({ url: req.url || "", body, method: req.method, headers: req.headers });
                res.setHeader("content-type", "application/json");
                if ((req.url || "").startsWith("/v1/governance/prepare")) {
                    res.end(JSON.stringify({ verdict: "ALLOW", reason: "ok", tool_call_id: "tc_1" }));
                } else if ((req.url || "").startsWith("/v1/context/build")) {
                    res.end(JSON.stringify({ session_id: "s1", instruction_patch: "ok", relevant_failures: [], constraints: [] }));
                } else if ((req.url || "").startsWith("/v1/governance/guard")) {
                    res.end(JSON.stringify({ verdict: "WARN", reason: "prior failure", warning: "be careful", risk_score: 0.6, matched_patterns: [] }));
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
        process.env.TERMYTE_AUTH_TOKEN = "test-auth-token";
        process.env.TERMYTE_ORG_ID = "test-org-id";
        process.env.TERMYTE_AGENT = "vitest";
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
        expect(requests[0]?.headers["x-termyte-auth-token"]).toBe("test-auth-token");
        expect(requests[0]?.headers["x-termyte-org-id"]).toBe("test-org-id");
        expect(requests[0]?.headers["x-termyte-agent"]).toBe("vitest");
        expect(requests[0]?.body).toMatchObject({
            session_id: "session-1",
            tool_name: "execute",
            payload_json: payload,
        });
    });

    it("commitToolCall calls /v1/governance/commit with correct payload", async () => {
        const client = new CloudKernelClient();
        const outcome = { stdout: "ok" };
        await client.commitToolCall({
            tool_call_id: "tc_1",
            outcome,
            success: true,
            exit_code: 0
        });

        expect(requests[0]?.url).toBe("/v1/governance/commit");
        expect(requests[0]?.method).toBe("POST");
        expect(requests[0]?.body).toMatchObject({
            tool_call_id: "tc_1",
            outcome_json: outcome,
            success: true,
            exit_code: 0
        });
    });

    it("contextBuild calls /v1/context/build with sanitized payload", async () => {
        const client = new CloudKernelClient();
        await client.contextBuild({ task: "fix auth", cwd: "/tmp/project", agent: "codex" });

        expect(requests[0]?.url).toBe("/v1/context/build");
        expect(requests[0]?.method).toBe("POST");
        expect(requests[0]?.body).toMatchObject({
            task: "fix auth",
            cwd: "/tmp/project",
            agent: "codex"
        });
    });

    it("guardAction calls /v1/governance/guard with sanitized payload", async () => {
        const client = new CloudKernelClient();
        await client.guardAction({
            session_id: "s1",
            action_type: "secret_read",
            intent: "inspect env",
            payload: { token: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" },
        });

        expect(requests[0]?.url).toBe("/v1/governance/guard");
        expect(requests[0]?.method).toBe("POST");
        expect(requests[0]?.body.session_id).toBe("s1");
        expect(JSON.stringify(requests[0]?.body)).toContain("[REDACTED]");
    });
});
