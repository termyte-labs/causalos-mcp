import fs from "fs/promises";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import { randomUUID } from "crypto";

const baseURL = process.env.TERMYTE_API_URL || "https://mcp.termyte.xyz";

async function getDeviceId() {
  if (process.env.TERMYTE_DEVICE_ID) {
    return process.env.TERMYTE_DEVICE_ID;
  }
  const configPath = path.join(os.homedir(), ".termyte", "config.json");
  const data = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (!data.device_id) {
    throw new Error("Missing device_id in ~/.termyte/config.json");
  }
  return data.device_id;
}

async function request(method, endpoint, body) {
  const url = new URL(endpoint, baseURL);
  const deviceId = await getDeviceId();
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          "content-type": "application/json",
          "x-termyte-device-id": deviceId,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data || "{}"));
          } catch {
            reject(new Error(`Invalid JSON response from ${endpoint}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function timed(label, fn) {
  const start = performance.now();
  const result = await fn();
  return { label, ms: performance.now() - start, result };
}

const sessionId = randomUUID();
const task = "evaluate governance memory loop";
const context = await timed("context_build", () =>
  request("POST", "/v1/context/build", {
    task,
    cwd: process.cwd(),
    project_name: "termyte",
    agent: "eval-harness",
    session_id: sessionId,
  })
);

const guard = await timed("guard_action", () =>
  request("POST", "/v1/governance/guard", {
    session_id: sessionId,
    action_type: "file_delete",
    intent: "delete a working directory recursively",
    payload: { command: "rm -rf ./tmp" },
    cwd: process.cwd(),
    project_name: "termyte",
  })
);

const prepare = await timed("prepare", () =>
  request("POST", "/v1/governance/prepare", {
    session_id: sessionId,
    tool_name: "execute",
    payload_json: {
      command: "git",
      args: ["status"],
      cwd: process.cwd(),
    },
  })
);

await request("POST", "/v1/governance/commit", {
  tool_call_id: prepare.result.tool_call_id,
  success: false,
  exit_code: 1,
  outcome_json: { stderr: "simulated failure" },
  stderr: "simulated failure",
  duration_ms: 12,
  parent_event_hash: null,
});

const replay = await timed("context_replay", () =>
  request("POST", "/v1/context/build", {
    task,
    cwd: process.cwd(),
    project_name: "termyte",
    agent: "eval-harness",
    session_id: sessionId,
  })
);

const summary = {
  session_id: sessionId,
  verdicts: {
    guard: guard.result.verdict,
    prepare: prepare.result.verdict,
  },
  latencies_ms: {
    context_build: Math.round(context.ms),
    guard_action: Math.round(guard.ms),
    prepare: Math.round(prepare.ms),
    context_replay: Math.round(replay.ms),
  },
  memory: {
    replay_constraints: replay.result.constraints?.length || 0,
    replay_failures: replay.result.relevant_failures?.length || 0,
  },
  success: guard.result.verdict === "BLOCK" && replay.result.relevant_failures?.length > 0,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.success ? 0 : 1);
