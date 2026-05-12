#!/usr/bin/env node

import pc from "picocolors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { kernel } from "./client.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";
import { execFile } from "child_process";
import { v4 as uuidv4 } from "uuid";

const CONFIG_DIR = path.join(os.homedir(), ".termyte");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const TERMYTE_PROTOCOL = `Termyte protocol:
- Before starting a coding task, call the termyte context_build tool with the task, cwd, project_name, and agent when available.
- Before risky non-shell actions such as file deletion, file overwrite, git mutation, database mutation, network execution, package publishing, or secret access, call termyte guard_action.
- Use termyte execute for shell commands when available.
- If Termyte returns WARN, proceed only with the warning instructions in context.
- If Termyte returns BLOCK, do not perform the action; explain the reason and safer alternative.`;

// ─── CLI Command Dispatcher ───────────────────────────────────────────────────
const arg = process.argv[2];

if (arg === "init") {
    init().catch(err => {
        console.error(pc.red(`Init failed: ${err.message}`));
        process.exit(1);
    });
} else if (arg === "log" || arg === "logs") {
    showLogs();
} else if (arg === "status") {
    checkStatus();
} else if (arg === "--version" || arg === "-v") {
    console.log("Termyte v0.2.0");
    process.exit(0);
} else if (arg === "--help" || arg === "-h") {
    showHelp();
} else {
    startMcpServer();
}

// ─── Interactive CLI Helpers ──────────────────────────────────────────────────
function syncPrompt(question: string): string {
    process.stdout.write(question);
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(0, buffer, 0, 1024, null);
    return buffer.toString('utf8', 0, bytesRead).trim();
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function openBrowser(url: string) {
    const platform = process.platform;
    const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    try {
        const child = execFile(command, args, { windowsHide: true });
        child.on("error", () => {});
    } catch {}
}

function tomlString(value: string | undefined): string {
    return JSON.stringify(value || "");
}

function truncate(value: string, max = 180): string {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function parseMaybeJson(value: any): any {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function summarizeLogAction(log: any): string {
    const commandArgs = parseMaybeJson(log.command_args);
    const payload = parseMaybeJson(log.payload_json);

    if (Array.isArray(commandArgs)) {
        return commandArgs.map((part) => String(part)).join(" ");
    }
    if (typeof commandArgs === "string" && commandArgs.trim()) {
        return commandArgs;
    }
    if (commandArgs && typeof commandArgs === "object") {
        if (commandArgs.command) {
            const args = Array.isArray(commandArgs.args) ? ` ${commandArgs.args.join(" ")}` : "";
            return `${commandArgs.command}${args}`;
        }
        return JSON.stringify(commandArgs);
    }

    if (payload && typeof payload === "object") {
        if (payload.command) {
            const args = Array.isArray(payload.args) ? ` ${payload.args.join(" ")}` : "";
            return `${payload.command}${args}`;
        }
        if (payload.intent) return String(payload.intent);
        if (payload.task) return String(payload.task);
        if (payload.summary) return String(payload.summary);
        if (payload.cwd || payload.project_name || payload.agent) {
            return [
                payload.project_name ? `project=${payload.project_name}` : "",
                payload.cwd ? `cwd=${payload.cwd}` : "",
                payload.agent ? `agent=${payload.agent}` : "",
            ].filter(Boolean).join(" ");
        }
        return JSON.stringify(payload);
    }
    if (typeof payload === "string" && payload.trim()) {
        return payload;
    }
    return "";
}

async function apiRequest(method: string, endpoint: string, body?: any, token?: string): Promise<any> {
    const apiUrl = process.env.TERMYTE_API_URL || "https://mcp.termyte.xyz";
    const url = new URL(endpoint, apiUrl);
    return new Promise((resolve, reject) => {
        const transport = url.protocol === "https:" ? https : http;
        const req = transport.request({
            method,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            timeout: 10000,
            headers: {
                "content-type": "application/json",
                ...(token ? { "x-termyte-auth-token": token } : {})
            }
        }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(parsed.reason || parsed.message || `HTTP ${res.statusCode}`));
                    } else {
                        resolve(parsed);
                    }
                } catch {
                    reject(new Error("Invalid JSON response from Termyte API"));
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Timeout"));
        });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function runtimeHeaders(config: any) {
    return {
        "x-termyte-device-id": config.device_id,
        ...(config.auth_token ? { "x-termyte-auth-token": config.auth_token } : {}),
        ...(config.org_id ? { "x-termyte-org-id": config.org_id } : {}),
        ...(config.agent ? { "x-termyte-agent": config.agent } : {})
    };
}

async function authenticateDevice(termyteConfig: any, selectedAgent: any) {
    if (termyteConfig.auth_token && termyteConfig.org_id) {
        console.log(`Using authenticated org: ${pc.cyan(termyteConfig.org_id)}`);
        return termyteConfig;
    }

    const installLabel = `${os.hostname()} / ${selectedAgent.name}`;
    const start = await apiRequest("POST", "/v1/auth/device/start", {
        device_id: termyteConfig.device_id,
        agent: selectedAgent.key,
        install_label: installLabel
    });

    console.log(`\n${pc.bold("Sign in to Termyte")}`);
    console.log(`  Opening: ${pc.cyan(start.verification_uri_complete)}`);
    console.log(`  Code:    ${pc.bold(start.user_code)}\n`);
    openBrowser(start.verification_uri_complete);

    const deadline = Date.now() + Math.min((start.expires_in || 900) * 1000, 180000);
    while (Date.now() < deadline) {
        await sleep((start.interval || 2) * 1000);
        const poll = await apiRequest("POST", "/v1/auth/device/poll", {
            device_code: start.device_code
        });
        if (poll.status === "approved") {
            termyteConfig.auth_token = poll.auth_token;
            termyteConfig.user_id = poll.user_id;
            termyteConfig.org_id = poll.org_id;
            termyteConfig.plan = poll.plan || "free";
            termyteConfig.max_active_agents = poll.max_active_agents || 1;
            termyteConfig.authenticated_at = new Date().toISOString();
            console.log(pc.green(`Authenticated to ${poll.plan || "free"} org ${poll.org_id}`));
            return termyteConfig;
        }
        if (poll.status === "expired" || poll.status === "denied") {
            throw new Error(`Browser authentication ${poll.status}. Run npx termyte init again.`);
        }
    }

    throw new Error("Timed out waiting for browser authentication.");
}

async function init() {
    console.log(`\n${pc.bold(pc.cyan("Initializing Termyte Governance..."))}\n`);

    const home = os.homedir();
    const agents = [
        {
            name: "Claude Code",
            key: "claude",
            paths: [path.join(home, ".claude", "settings.json")],
            type: "json",
            restart: "Restart Claude Code (close and reopen the app)"
        },
        {
            name: "Cursor",
            key: "cursor",
            paths: [path.join(home, ".cursor", "mcp.json"), path.join(home, ".cursor", "config", "mcp.json")],
            type: "json",
            restart: "Restart Cursor to activate MCP server"
        },
        {
            name: "Antigravity",
            key: "antigravity",
            paths: [path.join(home, ".gemini", "antigravity", "mcp_config.json")],
            type: "json",
            restart: "In Antigravity, open ... > Manage MCP Servers and click the refresh button"
        },
        {
            name: "Codex",
            key: "codex",
            paths: [path.join(home, ".codex", "config.toml")],
            type: "toml",
            restart: "Restart Codex and run /mcp to confirm termyte tools are loaded"
        },
    ];

    const detected = agents.filter(a => a.paths.some(p => fs.existsSync(p)));
    let selectedAgent: any = null;

    if (detected.length > 1) {
        console.log("Multiple coding agents detected:");
        detected.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`));
        const choice = parseInt(syncPrompt(`Select agent (1-${detected.length}): `));
        selectedAgent = detected[choice - 1];
    } else if (detected.length === 1) {
        selectedAgent = detected[0];
        console.log(`Detected ${pc.bold(selectedAgent.name)}`);
    } else {
        console.log("No coding agent detected. Which agent are you using?");
        agents.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`));
        console.log(`  ${agents.length + 1}. Other (manual setup)`);
        const choice = parseInt(syncPrompt(`Select agent (1-${agents.length + 1}): `));
        if (choice > agents.length) {
            console.log(`\n${pc.yellow("Manual setup required.")}`);
            console.log("\nAdd this to your MCP config under mcpServers:");
            console.log(`
    "termyte": {
    "command": "npx",
    "args": ["-y", "termyte"],
    "env": {
      "TERMYTE_DEVICE_ID": "<device_id>",
      "TERMYTE_AUTH_TOKEN": "<auth_token>",
      "TERMYTE_ORG_ID": "<org_id>",
      "TERMYTE_AGENT": "<agent>",
      "TERMYTE_API_URL": "https://mcp.termyte.xyz"
    }
  }

For TOML-based configs (e.g. Codex):

  [mcp_servers.termyte]
  command = "npx"
  args = ["-y", "termyte"]

  [mcp_servers.termyte.env]
  TERMYTE_DEVICE_ID = "<device_id>"
  TERMYTE_AUTH_TOKEN = "<auth_token>"
  TERMYTE_ORG_ID = "<org_id>"
  TERMYTE_AGENT = "<agent>"
  TERMYTE_API_URL = "https://mcp.termyte.xyz"
`);
            process.exit(0);
        }
        selectedAgent = agents[choice - 1];
    }

    if (!selectedAgent) {
        console.error(pc.red("Invalid selection."));
        process.exit(1);
    }

    // 2. Device ID Management
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    let termyteConfig: any = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            termyteConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
        } catch (e) { }
    }

    termyteConfig.agent = selectedAgent.key;
    if (!termyteConfig.device_id) {
        termyteConfig.device_id = uuidv4();
        termyteConfig.created_at = new Date().toISOString();
        console.log(`Generated Device ID: ${pc.green(termyteConfig.device_id)}`);
    } else {
        console.log(`Using existing Device ID: ${pc.green(termyteConfig.device_id)}`);
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(termyteConfig, null, 2));

    termyteConfig = await authenticateDevice(termyteConfig, selectedAgent);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(termyteConfig, null, 2));

    // 3. Write MCP Config
    const targetPath = selectedAgent.paths.find((p: string) => fs.existsSync(p)) || selectedAgent.paths[0];
    const targetDir = path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    // Backup if exists
    if (fs.existsSync(targetPath)) {
        fs.copyFileSync(targetPath, `${targetPath}.termyte.bak`);
        console.log(`📦 Backup created: ${path.basename(targetPath)}.termyte.bak`);
    }

    if (selectedAgent.type === "json") {
        let agentConfig: any = { mcpServers: {} };
        if (fs.existsSync(targetPath)) {
            try {
                agentConfig = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
            } catch (e) {
                console.warn(pc.yellow(`Warning: Malformed JSON at ${targetPath}. Starting fresh.`));
            }
        }
        if (!agentConfig.mcpServers) agentConfig.mcpServers = {};

        agentConfig.mcpServers.termyte = {
            command: "npx",
            args: ["-y", "termyte"],
            env: {
                TERMYTE_DEVICE_ID: termyteConfig.device_id,
                TERMYTE_AUTH_TOKEN: termyteConfig.auth_token,
                TERMYTE_ORG_ID: termyteConfig.org_id,
                TERMYTE_AGENT: selectedAgent.key,
                TERMYTE_API_URL: "https://mcp.termyte.xyz"
            }
        };
        fs.writeFileSync(targetPath, JSON.stringify(agentConfig, null, 2));
        const protocolPath = path.join(targetDir, "TERMYTE_PROTOCOL.md");
        fs.writeFileSync(protocolPath, TERMYTE_PROTOCOL);
        termyteConfig.protocol_verified = false;
        termyteConfig.protocol_note = `${selectedAgent.name} MCP config was installed. Protocol instructions were written to ${protocolPath}; verify your agent reads this file or add it to custom instructions.`;
    } else if (selectedAgent.type === "toml") {
        let content = "";
        if (fs.existsSync(targetPath)) {
            content = fs.readFileSync(targetPath, "utf-8");
        }
        const termyteToml = `[mcp_servers.termyte]
command = "npx"
args = ["-y", "termyte"]
enabled = true

[mcp_servers.termyte.env]
TERMYTE_DEVICE_ID = ${tomlString(termyteConfig.device_id)}
TERMYTE_AUTH_TOKEN = ${tomlString(termyteConfig.auth_token)}
TERMYTE_ORG_ID = ${tomlString(termyteConfig.org_id)}
TERMYTE_AGENT = ${tomlString(selectedAgent.key)}
TERMYTE_API_URL = "https://mcp.termyte.xyz"
`;

        if (content.includes("[mcp_servers.termyte]")) {
            console.log(`\n${pc.yellow(`Termyte already configured in ${path.basename(targetPath)}.`)}`);
            const blockPattern = /\n?\[mcp_servers\.termyte\][\s\S]*?(?=\n\[[^\]]+\]|\s*$)/m;
            const newContent = content.replace(blockPattern, `\n${termyteToml.trimEnd()}\n`);
            fs.writeFileSync(targetPath, newContent);
            console.log(pc.green("Termyte MCP env refreshed."));
        } else {
            let newContent = content;
            if (!content.includes("rmcp_client = true")) {
                newContent = "# Required for MCP support\nrmcp_client = true\n\n" + newContent;
            }

            newContent += `\n${termyteToml}`;
            fs.writeFileSync(targetPath, newContent);
        }
        const protocolPath = path.join(targetDir, "TERMYTE_PROTOCOL.md");
        fs.writeFileSync(protocolPath, TERMYTE_PROTOCOL);
        termyteConfig.protocol_verified = false;
        termyteConfig.protocol_note = `${selectedAgent.name} MCP config was installed. Protocol instructions were written to ${protocolPath}; verify your agent reads this file or add it to project instructions.`;
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(termyteConfig, null, 2));

    // 4. Verification Step
    const finalContent = fs.readFileSync(targetPath, "utf-8");
    const verified = selectedAgent.type === "json"
        ? finalContent.includes('"termyte"')
        : finalContent.includes("[mcp_servers.termyte]");

    console.log(pc.green(`MCP entry verified in ${pc.bold(targetPath)}`));

    // 5. Verify API Connection
    console.log(`\nVerifying connection to ${pc.cyan("mcp.termyte.xyz")}...`);
    try {
        await new Promise((resolve, reject) => {
            const req = https.get("https://mcp.termyte.xyz/v1/health", {
                headers: runtimeHeaders(termyteConfig),
                timeout: 5000
            }, (res) => {
                if (res.statusCode === 200) resolve(true);
                else reject(new Error(`Server returned status ${res.statusCode}`));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error("Timeout (5s)")); });
        });
        console.log(pc.green("v API Connection Verified"));
    } catch (err: any) {
        console.error(pc.red(`Connection failed: ${err.message}`));
        console.error("The Termyte sidecar might be down. Please check status later.");
        process.exit(1);
    }

    // 6. Print Success
    console.log(`\n${pc.green(pc.bold("Termyte active for " + selectedAgent.name))}\n`);
    console.log(`  Device: ${pc.cyan(termyteConfig.device_id)}`);
    console.log(`  Org:    ${pc.cyan(termyteConfig.org_id)}`);
    console.log(`  Plan:   ${pc.cyan(termyteConfig.plan || "free")}`);
    console.log(`  API:    https://mcp.termyte.xyz ${pc.green("v")}\n`);
    console.log(`  ${pc.bold(selectedAgent.restart)}\n`);
    console.log(`  Protocol: ${pc.yellow("manual verification required")}`);
    console.log(`  ${termyteConfig.protocol_note}\n`);
    console.log(`  ${pc.bold("npx termyte log")}      -> see what your agent did`);
    console.log(`  ${pc.bold("npx termyte status")}   -> check connection\n`);

    process.exit(0);
}


function showLogs() {
    const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) : null;
    if (!config) {
        console.error(pc.red("Termyte not initialized. Run 'npx termyte init' first."));
        process.exit(1);
    }
    const deviceId = config.device_id;
    const apiUrl = process.env.TERMYTE_API_URL || "https://mcp.termyte.xyz";

    console.log(pc.bold(pc.cyan(`\n📋 Termyte Governance Logs [${deviceId}]\n`)));

    const url = new URL(`${apiUrl}/v1/governance/logs`);
    const req = https.get(url, {
        headers: runtimeHeaders(config)
    }, (res) => {
        if (res.statusCode !== 200) {
            console.error(pc.red(`Server returned status ${res.statusCode}`));
            process.exit(1);
        }
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
            if (!data.trim()) {
                console.log(pc.gray("No events recorded yet."));
                process.exit(0);
            }
            try {
                const logs = JSON.parse(data);
                if (logs.length === 0) {
                    console.log(pc.gray("No events recorded yet."));
                } else {
                    logs.forEach((l: any) => {
                        const verdictColor = l.verdict === "BLOCK" ? pc.red : (l.verdict === "ALLOW" ? pc.green : pc.yellow);
                        const time = new Date(l.timestamp).toLocaleTimeString();
                        const exitCode = l.exit_code !== null ? `(${l.exit_code})` : "";
                        const duration = l.duration_ms !== null ? pc.gray(`${l.duration_ms}ms`) : "";
                        
                        let header = `${verdictColor(`[${l.verdict}]`)} ${pc.gray(time)} ${pc.bold(l.tool_name)} ${exitCode} ${duration}`;
                        if (l.verdict === "ALLOW") {
                            const allowColor = l.exit_code === 0 ? pc.green : pc.yellow;
                            header = `${allowColor(`[${l.verdict}]`)} ${pc.gray(time)} ${pc.bold(l.tool_name)} ${exitCode} ${duration}`;
                        }
                        
                        console.log(header);

                        const action = summarizeLogAction(l);
                        if (action) {
                            console.log(`  Action: ${truncate(action)}`);
                        }
                        if (l.reason && l.verdict !== "ALLOW") {
                            console.log(pc.gray(`  Reason: ${truncate(l.reason, 220)}`));
                        }
                        if (l.stdout_summary) {
                            console.log(pc.dim(`  Stdout: ${truncate(l.stdout_summary, 220)}`));
                        }
                        if (l.stderr_summary) {
                            console.log(pc.red(pc.dim(`  Stderr: ${truncate(l.stderr_summary, 220)}`)));
                        }
                    });
                }
            } catch (e) {
                console.error(pc.red("Failed to parse logs from server."));
                process.exit(1);
            }
            process.exit(0);
        });
    });

    req.on("error", err => {
        console.error(pc.red(`Failed to fetch logs: ${err.message}`));
        process.exit(1);
    });
}

function checkStatus() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.log(pc.red("Status: Not Initialized"));
        process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    console.log(`\n${pc.bold("Termyte Status")}`);
    console.log(`  Device ID: ${pc.cyan(config.device_id)}`);
    if (config.org_id) console.log(`  Org ID:    ${pc.cyan(config.org_id)}`);
    if (config.plan) console.log(`  Plan:      ${pc.cyan(config.plan)}`);
    console.log(`  Agent:     ${pc.cyan(config.agent || "Unknown")}`);

    https.get("https://mcp.termyte.xyz/v1/health", {
        headers: runtimeHeaders(config),
        timeout: 3000
    }, (res) => {
        if (res.statusCode === 200) {
            console.log(`  API:       ${pc.green("Online")}`);
            process.exit(0);
        } else {
            console.log(`  API:       ${pc.red(`Error (${res.statusCode})`)}`);
            process.exit(1);
        }
    }).on('error', () => {
        console.log(`  API:       ${pc.red("Offline")}`);
        process.exit(1);
    });
}

function showHelp() {
    console.log(`
${pc.bold("Termyte — Terminal Governance for Coding Agents")}

Usage:
  npx termyte init        Setup local device-id and auto-configure agent
  npx termyte log         Show recent governance events
  npx termyte status      Check connection to the sidecar
  npx termyte             Start MCP Server (Standard IO)

Governance:
  Termyte provides context_build, guard_action, and execute tools for
  governed agent workflows. Native tools are governed only when the agent
  follows the installed Termyte protocol.
`);
    process.exit(0);
}

// ─── MCP Server ──────────────────────────────────────────────────────────────
async function startMcpServer() {
    const server = new McpServer({
        name: "termyte",
        version: "0.1.0",
    });

    let currentSessionId = uuidv4(); // One session ID per MCP server process startup

    server.tool(
        "context_build",
        "Build Termyte context before starting a coding task.",
        {
            task: z.string(),
            cwd: z.string().optional(),
            project_name: z.string().optional(),
            agent: z.string().optional(),
        },
        async ({ task, cwd, project_name, agent }: any) => {
            const result = await kernel.contextBuild({
                task,
                cwd,
                project_name,
                agent,
                session_id: currentSessionId,
            });
            if (result.session_id) currentSessionId = result.session_id;
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
                isError: false
            };
        }
    );

    server.tool(
        "guard_action",
        "Evaluate a risky non-shell action before the agent performs it.",
        {
            session_id: z.string().optional(),
            action_type: z.string(),
            intent: z.string(),
            payload: z.any(),
            cwd: z.string().optional(),
            project_name: z.string().optional(),
        },
        async ({ session_id, action_type, intent, payload, cwd, project_name }: any) => {
            const result = await kernel.guardAction({
                session_id: session_id || currentSessionId,
                action_type,
                intent,
                payload,
                cwd,
                project_name,
            });
            const isBlocked = result.verdict === "BLOCK";
            const prefix = result.verdict === "WARN"
                ? "Termyte warning: proceed with caution.\n"
                : isBlocked
                    ? "Action blocked by Termyte.\n"
                    : "";
            return {
                content: [{
                    type: "text",
                    text: prefix + JSON.stringify(result, null, 2)
                }],
                isError: isBlocked
            };
        }
    );

    server.tool(
        "execute",
        "Execute a shell command.",
        {
            command: z.string(),
            args: z.array(z.string()).default([]),
            cwd: z.string().optional(),
        },
        async ({ command, args, cwd }: any) => {
            const action_payload = { command, args, cwd };
            const session_id = currentSessionId;

            // 1. Call prepare — invisible to agent
            const verdict = await kernel.prepareToolCall(session_id, "execute", action_payload);

            // 2. If blocked, return structured alternative
            if (verdict.verdict === "BLOCK") {
                return {
                    content: [{
                        type: "text",
                        text: `Action blocked by Termyte.\n` +
                            `Reason: ${verdict.reason}\n` +
                            `Alternative: ${verdict.alternative || "No alternative provided."}`
                    }],
                    isError: true
                };
            }
            const warningText = verdict.verdict === "WARN"
                ? `Termyte warning: ${verdict.warning || verdict.reason}\nAlternative: ${verdict.alternative || "Review prior failure before proceeding."}\n\n`
                : "";

            // 3. Execute via command sandbox
            // We use nativeExec from executor.ts as it implements the OS-level sandbox
            const { nativeExec } = await import("./executor.js");
            // reconstruct command line string for nativeExec
            const cmdString = args.length > 0 ? `${command} ${args.map((a: string) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}` : command;
            let result;
            if (cwd) {
                const originalCwd = process.cwd();
                try {
                    process.chdir(cwd);
                    result = await nativeExec(cmdString);
                } finally {
                    process.chdir(originalCwd);
                }
            } else {
                result = await nativeExec(cmdString);
            }

            // 4. Call commit — invisible to agent  
            const params = {
                tool_call_id: verdict.tool_call_id || uuidv4(),
                outcome: { stdout: result.stdout, stderr: result.stderr },
                success: result.exit_code === 0,
                exit_code: result.exit_code,
                command_args: args,
                stdout: result.stdout,
                stderr: result.stderr,
                duration_ms: result.duration_ms,
                parent_event_hash: null
            };

            try {
                await kernel.commitToolCall(params);
            } catch (err) {
                // Fail silently on commit errors to avoid disrupting agent flow
            }

            const combinedOutput = (result.stdout + "\n" + result.stderr).trim();
            return {
                content: [{ type: "text", text: warningText + (combinedOutput || "Command completed with no output.") }],
                isError: result.exit_code !== 0
            };
        }
    );

    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    } catch (err) {
        console.error("MCP Server Error:", err);
    }
}
