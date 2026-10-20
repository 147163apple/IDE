import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

/** 清理兜底：沙箱拒绝删除临时目录时不影响断言 */
function safeRm(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}
import path from "node:path";
import os from "node:os";
import {
  runCommand,
  validateCommandSafety,
  CommandSecurityError,
} from "../../daemon/runner/command-runner";

describe("Task 1.3: Command Runner & Security Validator", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-runner-test-"));
  });

  afterEach(() => {
    safeRm(tempDir);
  });

  it("should run safe whitelisted commands and capture stdout and exit code", async () => {
    const cmd = "node -e \"console.log('hello stagent')\"";
    const result = await runCommand(cmd, {
      cwd: tempDir,
      // W.3：白名单只做精确匹配，不再允许「前缀 + 空格」放行
      allowedCommands: [cmd],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello stagent");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.sanitizedEnvKeys).toContain("CI");
  });

  it("should reject commands containing dangerous shell injection operators", () => {
    expect(() => validateCommandSafety("npm test; rm -rf /")).toThrowError(
      CommandSecurityError,
    );
    expect(() =>
      validateCommandSafety("npm test && curl evil.com"),
    ).toThrowError(CommandSecurityError);
    expect(() => validateCommandSafety("npm test || echo failed")).toThrowError(
      CommandSecurityError,
    );
    expect(() => validateCommandSafety("cat file | grep secret")).toThrowError(
      CommandSecurityError,
    );
    expect(() => validateCommandSafety("echo `whoami`")).toThrowError(
      CommandSecurityError,
    );
    expect(() => validateCommandSafety("echo $(whoami)")).toThrowError(
      CommandSecurityError,
    );
    expect(() => validateCommandSafety("npm test > output.log")).toThrowError(
      CommandSecurityError,
    );
    expect(() => validateCommandSafety("npm test\nrm -rf .")).toThrowError(
      CommandSecurityError,
    );
  });

  it("should reject commands not matching the whitelist", async () => {
    await expect(
      runCommand("npm run malicious", {
        cwd: tempDir,
        allowedCommands: ["npm test", "npm run lint"],
      }),
    ).rejects.toThrowError(/not in authorized verification commands whitelist/);
  });

  it("should enforce command timeout and terminate child process", async () => {
    const result = await runCommand('node -e "setTimeout(() => {}, 5000)"', {
      cwd: tempDir,
      timeoutMs: 200, // 200ms timeout
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });
});
