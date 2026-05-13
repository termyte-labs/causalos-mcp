import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type AgentKind = "json" | "toml";

export interface SupportedAgent {
    name: string;
    key: string;
    type: AgentKind;
    restart: string;
    paths: string[];
}

export interface IntegrationCheck {
    name: string;
    key: string;
    path: string | null;
    configured: boolean;
    verified: boolean;
    kind: AgentKind;
    reason: string;
}

export function getSupportedAgents(home = os.homedir()): SupportedAgent[] {
    return [
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
            name: "Codex",
            key: "codex",
            paths: [path.join(home, ".codex", "config.toml")],
            type: "toml",
            restart: "Restart Codex and run /mcp to confirm termyte tools are loaded"
        },
    ];
}

function inspectJsonIntegration(agent: SupportedAgent, configPath: string, content: string): IntegrationCheck {
    try {
        const parsed = JSON.parse(content);
        const entry = parsed?.mcpServers?.termyte;
        const env = entry?.env || {};
        const commandOk = entry?.command === "npx";
        const args = Array.isArray(entry?.args) ? entry.args.map(String) : [];
        const configured = Boolean(entry);
        const verified = configured &&
            commandOk &&
            args.includes("termyte") &&
            Boolean(env.TERMYTE_DEVICE_ID) &&
            Boolean(env.TERMYTE_AUTH_TOKEN) &&
            Boolean(env.TERMYTE_ORG_ID) &&
            Boolean(env.TERMYTE_AGENT);
        return {
            name: agent.name,
            key: agent.key,
            path: configPath,
            configured,
            verified,
            kind: agent.type,
            reason: verified
                ? `${agent.name} MCP entry is installed and bound to authenticated Termyte env values.`
                : configured
                    ? `${agent.name} MCP entry exists but is missing required Termyte fields.`
                    : `${agent.name} MCP entry is missing.`,
        };
    } catch {
        return {
            name: agent.name,
            key: agent.key,
            path: configPath,
            configured: false,
            verified: false,
            kind: agent.type,
            reason: `${agent.name} config is not valid JSON.`,
        };
    }
}

function inspectTomlIntegration(agent: SupportedAgent, configPath: string, content: string): IntegrationCheck {
    const hasSection = content.includes("[mcp_servers.termyte]");
    const commandOk = /command\s*=\s*"npx"/.test(content);
    const argsOk = content.includes('args = ["-y", "termyte"]') || content.includes('termyte');
    const envOk = content.includes("TERMYTE_DEVICE_ID") &&
        content.includes("TERMYTE_AUTH_TOKEN") &&
        content.includes("TERMYTE_ORG_ID") &&
        content.includes("TERMYTE_AGENT");
    const configured = hasSection;
    const verified = configured && commandOk && argsOk && envOk && content.includes("enabled = true");
    return {
        name: agent.name,
        key: agent.key,
        path: configPath,
        configured,
        verified,
        kind: agent.type,
        reason: verified
            ? `${agent.name} MCP entry is installed and bound to authenticated Termyte env values.`
            : configured
                ? `${agent.name} MCP entry exists but is missing required Termyte fields.`
                : `${agent.name} MCP entry is missing.`,
    };
}

export function inspectIntegration(agent: SupportedAgent): IntegrationCheck {
    const existingPath = agent.paths.find((p) => fs.existsSync(p)) || agent.paths[0];
    if (!existingPath) {
        return {
            name: agent.name,
            key: agent.key,
            path: null,
            configured: false,
            verified: false,
            kind: agent.type,
            reason: `${agent.name} config file is not present.`,
        };
    }

    if (!fs.existsSync(existingPath)) {
        return {
            name: agent.name,
            key: agent.key,
            path: existingPath,
            configured: false,
            verified: false,
            kind: agent.type,
            reason: `${agent.name} config file is not present at ${existingPath}.`,
        };
    }

    const content = fs.readFileSync(existingPath, "utf-8");
    return agent.type === "json"
        ? inspectJsonIntegration(agent, existingPath, content)
        : inspectTomlIntegration(agent, existingPath, content);
}

export function verifySupportedIntegrations(home = os.homedir()): IntegrationCheck[] {
    return getSupportedAgents(home).map((agent) => inspectIntegration(agent));
}
