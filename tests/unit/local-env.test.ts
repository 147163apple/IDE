import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyDeepSeekOpenAiCompatMapping,
  deriveOpenAiCompatibleBaseUrl,
  injectLocalModelEnv,
  loadLocalEnvFile,
} from "../../daemon/core/local-env";

const touchedKeys = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "STAGENT_MODEL",
  "UNIT_TEST_LOCAL_ENV_ONLY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of touchedKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of touchedKeys) {
    const prev = saved[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

describe("deriveOpenAiCompatibleBaseUrl", () => {
  it("把 DeepSeek Anthropic 口换成 /v1 OpenAI 口", () => {
    expect(
      deriveOpenAiCompatibleBaseUrl("https://api.deepseek.com/anthropic"),
    ).toBe("https://api.deepseek.com/v1");
  });

  it("已是 /v1 则保持", () => {
    expect(deriveOpenAiCompatibleBaseUrl("https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/v1",
    );
  });
});

describe("loadLocalEnvFile", () => {
  it("解析 export KEY=value，不覆盖已有环境，且返回值不含密钥", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-env-"));
    const rel = ".tmp/deepseek.env";
    fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
    const secret = "sk-unit-test-never-log-this-value";
    fs.writeFileSync(
      path.join(dir, rel),
      [
        "export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic",
        `export ANTHROPIC_API_KEY=${secret}`,
        "export ANTHROPIC_MODEL=deepseek-chat",
        "UNIT_TEST_LOCAL_ENV_ONLY=already",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    process.env["UNIT_TEST_LOCAL_ENV_ONLY"] = "pre-set";

    const result = loadLocalEnvFile(dir, rel);
    expect(result.loaded).toBe(true);
    expect(result.injectedKeys).toEqual(
      expect.arrayContaining([
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_MODEL",
      ]),
    );
    expect(result.skippedKeys).toContain("UNIT_TEST_LOCAL_ENV_ONLY");
    expect(process.env["ANTHROPIC_API_KEY"]).toBe(secret);
    expect(process.env["UNIT_TEST_LOCAL_ENV_ONLY"]).toBe("pre-set");

    // 诊断载荷不得含密钥明文
    const dumped = JSON.stringify(result);
    expect(dumped).not.toContain(secret);
  });

  it("文件不存在 → loaded=false", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-env-missing-"));
    const result = loadLocalEnvFile(dir);
    expect(result.loaded).toBe(false);
    expect(result.injectedKeys).toEqual([]);
  });
});

describe("applyDeepSeekOpenAiCompatMapping + injectLocalModelEnv", () => {
  it("从 ANTHROPIC_* 映射 OPENAI_* / STAGENT_MODEL", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-map-test";
    process.env["ANTHROPIC_BASE_URL"] = "https://api.deepseek.com/anthropic";
    process.env["ANTHROPIC_MODEL"] = "deepseek-chat";
    const { mappedKeys } = applyDeepSeekOpenAiCompatMapping();
    expect(mappedKeys).toEqual(
      expect.arrayContaining([
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "STAGENT_MODEL",
      ]),
    );
    expect(process.env["OPENAI_BASE_URL"]).toBe("https://api.deepseek.com/v1");
    expect(process.env["OPENAI_API_KEY"]).toBe("sk-map-test");
    expect(process.env["STAGENT_MODEL"]).toBe("deepseek-chat");
  });

  it("injectLocalModelEnv 端到端：enrichReady 只看密钥是否在环境里", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-env-inj-"));
    fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".tmp/deepseek.env"),
      [
        "export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic",
        "export ANTHROPIC_API_KEY=sk-inject-ready",
        "export ANTHROPIC_MODEL=deepseek-chat",
      ].join("\n"),
    );
    const out = injectLocalModelEnv(dir);
    expect(out.envFile.loaded).toBe(true);
    expect(out.enrichReady).toBe(true);
    expect(JSON.stringify(out)).not.toContain("sk-inject-ready");
  });
});
