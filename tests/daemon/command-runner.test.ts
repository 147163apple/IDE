import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
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
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should run safe whitelisted commands and capture stdout and exit code", async () => {
    const result = await runCommand(
      "node -e \"console.log('hello stagent')\"",
      {
        cwd: tempDir,
        allowedCommands: ["node -e"],
      },
    );

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
