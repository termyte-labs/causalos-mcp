import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { inspectIntegration, type SupportedAgent } from "../integrations.js";

const createdDirs: string[] = [];

async function makeTempDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "termyte-integrations-"));
    createdDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (createdDirs.length) {
        const dir = createdDirs.pop();
        if (dir) {
            await fs.rm(dir, { recursive: true, force: true });
        }
    }
});

describe("integration verification", () => {
    it("verifies a Claude-style JSON MCP config", async () => {
        const dir = await makeTempDir();
        const configPath = path.join(dir, "settings.json");
        await fs.writeFile(configPath, JSON.stringify({
            mcpServers: {
                termyte: {
                    command: "npx",
                    args: ["-y", "termyte"],
                    env: {
                        TERMYTE_DEVICE_ID: "device-1",
                        TERMYTE_AUTH_TOKEN: "token-1",
                        TERMYTE_ORG_ID: "org-1",
                        TERMYTE_AGENT: "claude",
                    },
                },
            },
        }, null, 2));

        const agent: SupportedAgent = {
            name: "Claude Code",
            key: "claude",
            type: "json",
            restart: "restart",
            paths: [configPath],
        };

        const check = inspectIntegration(agent);
        expect(check.configured).toBe(true);
        expect(check.verified).toBe(true);
        expect(check.reason).toContain("authenticated Termyte env values");
    });

    it("verifies a Codex-style TOML MCP config", async () => {
        const dir = await makeTempDir();
        const configPath = path.join(dir, "config.toml");
        await fs.writeFile(configPath, `
[mcp_servers.termyte]
command = "npx"
args = ["-y", "termyte"]
enabled = true

[mcp_servers.termyte.env]
TERMYTE_DEVICE_ID = "device-1"
TERMYTE_AUTH_TOKEN = "token-1"
TERMYTE_ORG_ID = "org-1"
TERMYTE_AGENT = "codex"
TERMYTE_API_URL = "https://mcp.termyte.xyz"
`);

        const agent: SupportedAgent = {
            name: "Codex",
            key: "codex",
            type: "toml",
            restart: "restart",
            paths: [configPath],
        };

        const check = inspectIntegration(agent);
        expect(check.configured).toBe(true);
        expect(check.verified).toBe(true);
        expect(check.reason).toContain("authenticated Termyte env values");
    });

    it("reports a missing integration when no config exists", async () => {
        const dir = await makeTempDir();
        const configPath = path.join(dir, "mcp.json");
        const agent: SupportedAgent = {
            name: "Cursor",
            key: "cursor",
            type: "json",
            restart: "restart",
            paths: [configPath],
        };

        const check = inspectIntegration(agent);
        expect(check.configured).toBe(false);
        expect(check.verified).toBe(false);
        expect(check.reason).toContain("not present");
    });
});
