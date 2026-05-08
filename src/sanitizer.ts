import { createHash } from 'crypto';

/**
 * Sanitizer: Privacy-First Data Redaction for Termyte
 * 
 * This utility ensures that sensitive data (API keys, secrets, PII) is redacted 
 * locally within the MCP sidecar before any trajectory data is streamed to the Cloud Runtime.
 */
export class Sanitizer {
  private static SECRET_PATTERNS: Record<string, RegExp> = {
    // Standard cloud/service tokens
    AWS_KEY: /(?:ASIA|AKIA|AROA|AIDA)[A-Z0-9]{16}/g,
    AWS_SECRET: /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*(?:"|')?[A-Za-z0-9/+=]{40}(?:"|')?/gi,
    STRIPE_KEY: /sk_live_[0-9a-zA-Z]{24}/g,
    GITHUB_TOKEN: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}/g,
    SLACK_TOKEN: /xox[baprs]-[0-9a-zA-Z]{10,48}/g,
    
    // Generic authentication
    BEARER_TOKEN: /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
    BASIC_AUTH: /Basic\s+[a-zA-Z0-9+/]+=*/gi,
    PRIVATE_KEY: /-----BEGIN (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY-----[\s\S]+?-----END (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY-----/g,
    
    // Common sensitive field names in JSON
    JSON_SECRET_KEY: /"(?:password|secret|token|key|pwd|auth|credential|api_key)":\s*"[^"]+"/gi,
  };

  /**
   * Redacts sensitive information from a string or JSON object.
   */
  public static redact(input: any): any {
    if (typeof input === 'string') {
      return this.redactString(input);
    }

    if (typeof input === 'object' && input !== null) {
      return this.redactObject(input);
    }

    return input;
  }

  private static redactString(str: string): string {
    let result = str;
    for (const [label, pattern] of Object.entries(this.SECRET_PATTERNS)) {
        if (label === 'JSON_SECRET_KEY') {
            result = result.replace(pattern, (match) => {
                const parts = match.split(':');
                return `${parts[0]}: "[REDACTED]"`;
            });
        } else {
            result = result.replace(pattern, `[REDACTED_${label}]`);
        }
    }
    return result;
  }

  private static redactObject(obj: any): any {
    const jsonStr = JSON.stringify(obj);
    const redactedStr = this.redactString(jsonStr);
    try {
      return JSON.parse(redactedStr);
    } catch (e) {
      return redactedStr;
    }
  }

  /**
   * Generates a stable fingerprint of an action for caching.
   * Matches the format used in the Cloud Runtime: tool_name:sanitized_args_json
   */
  public static getFingerprint(toolName: string, args: any): string {
    let sanitizedArgs = this.redact(args);
    
    // Phase 3: Command Normalization for shell tools
    if (["run_command", "shell", "run_shell_command"].includes(toolName)) {
      sanitizedArgs = this.normalizeShellArgs(sanitizedArgs);
    }

    const argsJson = JSON.stringify(sanitizedArgs);
    const canonical = `${toolName}:${argsJson}`;
    return createHash('sha256').update(canonical).digest('hex');
  }

  private static normalizeShellArgs(args: any): any {
    if (typeof args === 'string') return this.normalizeCommandString(args);
    if (typeof args === 'object' && args !== null) {
      if (args.command) {
        return { ...args, command: this.normalizeCommandString(args.command) };
      }
    }
    return args;
  }

  /**
   * Normalizes volatile tokens in a command string so that the fingerprint
   * matches the one produced by the Rust kernel's Normalizer::normalize_shell().
   * Must stay in sync with cloud-runtime/src/normalizer.rs.
   */
  private static normalizeCommandString(cmd: string): string {
    const trimmed = cmd.trim();
    if (!trimmed) return cmd;

    // Mirror Rust RE_TEMP_PATH / RE_ABS_PATH / RE_REL_PATH / RE_SESSION_ID / RE_PORT
    let result = trimmed
      .replace(/(?:\/tmp\/|\/var\/tmp\/|\/var\/folders\/|%TEMP%)\S*/gi, '[TEMP_PATH]')
      .replace(/\/(?:[\w.-]+\/)*[\w.-]+/g, '[ABS_PATH]')
      .replace(/\.\.?\/(?:[\w.-]+\/)*[\w.-]+/g, '[REL_PATH]')
      .replace(/session-[a-z0-9]+/gi, '[SESSION_ID]')
      .replace(/port\s+\d{4,5}/gi, 'port [EPHEMERAL_PORT]');

    const parts = result.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return result;

    const verb = parts[0]!;
    const rest = parts.slice(1);

    // Separate flags (start with -) from positional arguments and sort flags for
    // canonical ordering — same logic as Rust: flags.sort() then non_flags.
    const flags = rest.filter(p => p.startsWith('-')).sort();
    const nonFlags = rest.filter(p => !p.startsWith('-'));

    return [verb, ...flags, ...nonFlags].join(' ');
  }
}
