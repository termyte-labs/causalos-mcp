import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";

let server: http.Server;
let baseUrl = "";
const requests: Array<{ url: string; body: any }> = [];

describe("Cloud contract", () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {};
        requests.push({ url: req.url || "", body });
        res.setHeader("content-type", "application/json");
        if ((req.url || "").startsWith("/v1/prepare")) {
          res.end(JSON.stringify({ action: "ALLOW", reason: "ok", tool_call_id: "tc_1" }));
        } else if ((req.url || "").startsWith("/v1/evaluate")) {
          res.end(JSON.stringify({ contract_hash: "h1", risk_score: 0.1, required_invariants: [], watchpoints: [] }));
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
    process.env.CAUSAL_RUNTIME_URL = baseUrl;
    process.env.CAUSAL_API_KEY = "sk-test-token";
  });

  beforeEach(() => {
    requests.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("evaluatePlan calls /v1/evaluate with expected body", async () => {
    const { CloudKernelClient } = await import("../cloud-client.js");
    const client = new CloudKernelClient();
    await client.evaluatePlan("agentA", "projectA", "taskA");
    expect(requests[0]?.url).toBe("/v1/evaluate");
    expect(requests[0]?.body).toMatchObject({
      agent_id: "agentA",
      project_id: "projectA",
      plan_text: "taskA",
    });
  });

  it("prepareToolCall calls /v1/prepare with normalized payload", async () => {
    const { CloudKernelClient } = await import("../cloud-client.js");
    const client = new CloudKernelClient();
    await client.prepareToolCall("c1", "p1", "shell", JSON.stringify({ command: "ls" }), "agent", "session");
    expect(requests[0]?.url).toBe("/v1/prepare");
    expect(requests[0]?.body).toMatchObject({
      contract_hash: "c1",
      parent_event_hash: "p1",
      tool_name: "shell",
      payload_json: { command: "ls" },
    });
  });
});
