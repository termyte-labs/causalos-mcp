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
import { v4 as uuidv4 } from "uuid";

const CONFIG_DIR = path.join(os.homedir(), ".termyte");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

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
      "TERMYTE_API_URL": "https://mcp.causalos.xyz"
    }
  }

For TOML-based configs (e.g. Codex):

  [mcp_servers.termyte]
  command = "npx"
  args = ["-y", "termyte"]

  [mcp_servers.termyte.env]
  TERMYTE_DEVICE_ID = "<device_id>"
  TERMYTE_API_URL = "https://mcp.causalos.xyz"
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
                TERMYTE_API_URL: "https://mcp.causalos.xyz"
            }
        };
        fs.writeFileSync(targetPath, JSON.stringify(agentConfig, null, 2));
    } else if (selectedAgent.type === "toml") {
        let content = "";
        if (fs.existsSync(targetPath)) {
            content = fs.readFileSync(targetPath, "utf-8");
        }

        if (content.includes("[mcp_servers.termyte]")) {
            console.log(`\n${pc.yellow(`Termyte already configured in ${path.basename(targetPath)}.`)}`);
        } else {
            let newContent = content;
            if (!content.includes("rmcp_client = true")) {
                newContent = "# Required for MCP support\nrmcp_client = true\n\n" + newContent;
            }

            newContent += `\n[mcp_servers.termyte]\ncommand = "npx"\nargs = ["-y", "termyte"]\n\n[mcp_servers.termyte.env]\nTERMYTE_DEVICE_ID = "${termyteConfig.device_id}"\nTERMYTE_API_URL = "https://mcp.causalos.xyz"\n`;
            fs.writeFileSync(targetPath, newContent);
        }
    }

    // 4. Verification Step
    const finalContent = fs.readFileSync(targetPath, "utf-8");
    const verified = selectedAgent.type === "json"
        ? finalContent.includes('"termyte"')
        : finalContent.includes("[mcp_servers.termyte]");

    console.log(pc.green(`MCP entry verified in ${pc.bold(targetPath)}`));

    // 5. Verify API Connection
    console.log(`\nVerifying connection to ${pc.cyan("mcp.causalos.xyz")}...`);
    try {
        await new Promise((resolve, reject) => {
            const req = https.get("https://mcp.causalos.xyz/v1/health", {
                headers: { "x-termyte-device-id": termyteConfig.device_id },
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
    console.log(`  API:    https://mcp.causalos.xyz ${pc.green("v")}\n`);
    console.log(`  ${pc.bold(selectedAgent.restart)}\n`);
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
    const apiUrl = process.env.TERMYTE_API_URL || "https://mcp.causalos.xyz";

    console.log(pc.bold(pc.cyan(`\n📋 Termyte Governance Logs [${deviceId}]\n`)));

    const url = new URL(`${apiUrl}/v1/governance/logs`);
    const req = https.get({
        hostname: url.hostname,
        path: url.pathname,
        headers: { "x-termyte-device-id": deviceId }
    }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
            const logs = JSON.parse(data);
            if (logs.length === 0) {
                console.log(pc.gray("No events recorded yet."));
            } else {
                logs.forEach((l: any) => {
                    const verdictColor = l.verdict === "ALLOW" ? pc.green : l.verdict === "BLOCK" ? pc.red : pc.yellow;
                    const time = new Date(l.timestamp).toLocaleTimeString();
                    const outcomeIcon = l.success === true ? pc.green("(v)") : l.success === false ? pc.red("(x)") : pc.gray("(-)");

                    console.log(`${verdictColor(`[${l.verdict}]`)} ${pc.gray(time)} ${pc.bold(l.tool_name)} ${outcomeIcon}`);

                    if (l.verdict === "BLOCK" && l.reason) {
                        console.log(pc.red(`  Reason: ${l.reason}`));
                    } else if (l.reason && l.verdict !== "ALLOW") {
                        console.log(pc.gray(`  Note: ${l.reason}`));
                    }
                });
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
    console.log(`  Agent:     ${pc.cyan(config.agent || "Unknown")}`);

    https.get("https://mcp.causalos.xyz/v1/health", {
        headers: { "x-termyte-device-id": config.device_id },
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
  Termyte intercepts agent actions, evaluates them against a deterministic 
  sandbox and LLM judge, and records everything in a secure ledger.
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
            await kernel.commitToolCall(
                verdict.tool_call_id || uuidv4(),
                { stdout: result.stdout, stderr: result.stderr },
                result.exit_code === 0,
                result.exit_code
            );

            const combinedOutput = (result.stdout + "\n" + result.stderr).trim();
            return {
                content: [{ type: "text", text: combinedOutput || "Command completed with no output." }],
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
