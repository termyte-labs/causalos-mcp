import { describe, it, expect } from "vitest";
import { nativeExec, tokenize } from "../executor.js";

describe("Command Execution Sandbox", () => {
    it("should tokenize commands correctly", () => {
        expect(tokenize('ls -la "/path/with spaces"')).toEqual(['ls', '-la', '/path/with spaces']);
    });

    it("ALLOW-01: 'node -v' should execute successfully", async () => {
        const result = await nativeExec("node -v");
        expect(result.exit_code).toBe(0);
        expect(result.stdout).toMatch(/v\d+\.\d+\.\d+/);
    });

    it("ALLOW-02: 'git --version' should pass validation", async () => {
        const result = await nativeExec("git --version");
        expect(result.exit_code).toBe(0);
        expect(result.stdout).toContain("git version");
    });
});
