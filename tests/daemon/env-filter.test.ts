import { describe, it, expect } from "vitest";
import { sanitizeEnvironment } from "../../daemon/runner/env-filter";

describe("Task 1.3: Subprocess Environment Sanitizer", () => {
  it("should strip sensitive credentials and cloud tokens", () => {
    const rawEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      AWS_SECRET_ACCESS_KEY: "super-secret-aws-key",
      GITHUB_TOKEN: "ghp_1234567890abcdef",
      OPENAI_API_KEY: "sk-12345678",
      ANTHROPIC_API_KEY: "sk-ant-1234",
      LOVABLE_API_KEY: "lov-sec-1234",
      DATABASE_PASSWORD: "mypassword",
      JWT_SECRET: "jwtsecret",
      SAFE_CUSTOM_VAR: "allowed-value",
    };

    const sanitized = sanitizeEnvironment(rawEnv);

    expect(sanitized["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
    expect(sanitized["GITHUB_TOKEN"]).toBeUndefined();
    expect(sanitized["OPENAI_API_KEY"]).toBeUndefined();
    expect(sanitized["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(sanitized["LOVABLE_API_KEY"]).toBeUndefined();
    expect(sanitized["DATABASE_PASSWORD"]).toBeUndefined();
    expect(sanitized["JWT_SECRET"]).toBeUndefined();

    // Standard preserved keys
    expect(sanitized["PATH"]).toBe("/usr/bin:/bin");
    expect(sanitized["HOME"]).toBe("/home/user");
    expect(sanitized["SAFE_CUSTOM_VAR"]).toBe("allowed-value");

    // Injected control keys
    expect(sanitized["CI"]).toBe("true");
    expect(sanitized["NODE_ENV"]).toBe("test");
    expect(sanitized["TERM"]).toBe("dumb");
  });

  it("should support explicit overrides and extra variables", () => {
    const rawEnv: NodeJS.ProcessEnv = {
      CUSTOM_TOKEN: "sensitive-by-name",
    };

    const sanitized = sanitizeEnvironment(rawEnv, {
      allowedKeyOverrides: ["CUSTOM_TOKEN"],
      extraEnv: {
        TEST_RUN_ID: "run-999",
      },
    });

    expect(sanitized["CUSTOM_TOKEN"]).toBe("sensitive-by-name");
    expect(sanitized["TEST_RUN_ID"]).toBe("run-999");
    expect(sanitized["CI"]).toBe("true");
  });
});
