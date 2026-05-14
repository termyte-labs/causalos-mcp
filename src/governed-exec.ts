import { v4 as uuidv4 } from "uuid";
import { nativeExec } from "./executor.js";
import { kernel } from "./client.js";
import { classifyCommandRisk, cloudBlockCanBeSoftened, type MvpRiskDecision } from "./risk-classifier.js";

export interface GovernedExecResult {
  decision: "ALLOW" | "WARN" | "BLOCK";
  risk: MvpRiskDecision;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  reason: string;
  warning?: string;
  alternative?: string;
  source: "local" | "cloud" | "local_with_cloud_warning";
}

export async function runGovernedCommand(input: {
  command: string;
  cwd?: string;
  session_id?: string;
}): Promise<GovernedExecResult> {
  const risk = classifyCommandRisk(input.command);

  if (risk.decision === "BLOCK") {
    return {
      decision: "BLOCK",
      risk,
      stdout: "",
      stderr: "",
      exit_code: 126,
      duration_ms: 0,
      reason: risk.reason,
      alternative: risk.alternative,
      source: "local",
    };
  }

  let cloudVerdict: any = null;
  let cloudWarning = "";
  const sessionId = input.session_id || uuidv4();

  try {
    cloudVerdict = await kernel.prepareToolCall(sessionId, "execute", {
      command: input.command,
      args: [],
      cwd: input.cwd,
      mvp_risk_class: risk.risk_class,
    });
  } catch (err: any) {
    cloudVerdict = {
      verdict: "WARN",
      reason: `Cloud policy unavailable: ${err?.message || String(err)}`,
      source: "local_fallback",
    };
  }

  if (cloudVerdict?.verdict === "BLOCK" && !cloudBlockCanBeSoftened(risk, cloudVerdict)) {
    return {
      decision: "BLOCK",
      risk,
      stdout: "",
      stderr: "",
      exit_code: 126,
      duration_ms: 0,
      reason: cloudVerdict.reason || "Blocked by Termyte policy.",
      alternative: cloudVerdict.alternative,
      source: "cloud",
    };
  }

  if (cloudVerdict?.verdict === "BLOCK" && cloudBlockCanBeSoftened(risk, cloudVerdict)) {
    cloudWarning = "";
  } else if (cloudVerdict?.verdict === "WARN") {
    cloudWarning = cloudVerdict.warning || cloudVerdict.reason || "";
  }

  const originalCwd = process.cwd();
  let execution;
  try {
    if (input.cwd) process.chdir(input.cwd);
    execution = await nativeExec(input.command);
  } finally {
    if (input.cwd) process.chdir(originalCwd);
  }

  const toolCallId = cloudVerdict?.tool_call_id || uuidv4();
  try {
    await kernel.commitToolCall({
      tool_call_id: toolCallId,
      outcome: { stdout: execution.stdout, stderr: execution.stderr },
      success: execution.exit_code === 0,
      exit_code: execution.exit_code,
      command_args: [input.command],
      stdout: execution.stdout,
      stderr: execution.stderr,
      duration_ms: execution.duration_ms,
      parent_event_hash: null,
    });
  } catch {}

  const warning = [risk.decision === "WARN" ? risk.reason : "", cloudWarning]
    .filter(Boolean)
    .join(" ");

  return {
    decision: warning ? "WARN" : "ALLOW",
    risk,
    stdout: execution.stdout,
    stderr: execution.stderr,
    exit_code: execution.exit_code,
    duration_ms: execution.duration_ms,
    reason: risk.reason,
    warning: warning || undefined,
    alternative: risk.alternative,
    source: cloudWarning ? "local_with_cloud_warning" : "local",
  };
}
