import { createHash } from 'crypto';

/**
 * Sanitizer: Privacy-First Data Redaction for CausalOS
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

  private static normalizeCommandString(cmd: string): string {
    const trimmed = cmd.trim();
    if (!trimmed) return cmd;

    const parts = trimmed.split(/\s+/);
    if (parts.length <= 1) return trimmed;

    const verb = parts[0];
    const rest = parts.slice(1);

    // Separate flags (start with -) from positional arguments
    // Note: This is a heuristic. Some tools use - for non-flags, but for fingerprinting it's usually fine.
    const flags = rest.filter(p => p.startsWith('-')).sort();
    const nonFlags = rest.filter(p => !p.startsWith('-'));

    // Reconstruct canonical command
    return [verb, ...flags, ...nonFlags].join(' ');
  }
}
