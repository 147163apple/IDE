import { describe, expect, it } from "vitest";
import {
  REDACTED_PLACEHOLDER,
  collectEnvironmentSecrets,
  redactDeep,
  redactText,
} from "../../src/lib/ipc/redaction";

/**
 * 共享深度脱敏（原 TASK-S.3 保留范围，随 TASK-S.2 移植）。
 *
 * 三层防线各有独立用例：漏掉任意一层，凭据都会以某种形态流出 Daemon。
 * 另有两类易错点单列：**先脱敏后截断**（顺序反了会留下半截秘密）与
 * **不修改入参**（广播后调用方继续用脏数据的经典事故）。
 */

describe("第一层：键名判定", () => {
  it("敏感键的值整体替换（含嵌套对象与数组），不论值类型", () => {
    const result = redactDeep({
      token: "abc",
      password: "p",
      api_key: "k",
      nested: { PRIVATE_KEY: { any: "shape" }, list: [{ secret: "s" }] },
    });

    expect(result.value).toEqual({
      token: REDACTED_PLACEHOLDER,
      password: REDACTED_PLACEHOLDER,
      api_key: REDACTED_PLACEHOLDER,
      nested: {
        PRIVATE_KEY: REDACTED_PLACEHOLDER,
        list: [{ secret: REDACTED_PLACEHOLDER }],
      },
    });
    expect(result.redacted).toBe(true);
    expect(result.redactions).toBe(5);
  });

  it("Authorization / Cookie 字符串凭据被抹除", () => {
    const result = redactDeep({
      Authorization: "Basic dXNlcjpwYXNz",
      headers: { cookie: "session=abc" },
    });
    expect(result.value).toEqual({
      Authorization: REDACTED_PLACEHOLDER,
      headers: { cookie: REDACTED_PLACEHOLDER },
    });
  });

  it("合同的 authorization 是权限块对象，不得被整体替换（避免破坏 Schema）", () => {
    const contract = {
      authorization: {
        git: { base_branch: "main" },
        budget_limits: { max_file_modifications: 10 },
      },
    };
    const result = redactDeep(contract);
    expect(result.value).toEqual(contract);
    expect(result.redacted).toBe(false);
  });

  it("无害键名不受影响", () => {
    const result = redactDeep({ title: "hello", count: 3, ok: true });
    expect(result.value).toEqual({ title: "hello", count: 3, ok: true });
    expect(result.redacted).toBe(false);
  });
});

describe("第二层：值指纹", () => {
  it("登记的已知秘密按子串精确抹除", () => {
    const secret = "correct-horse-battery";
    const result = redactText(`env holds ${secret} twice: ${secret}`, {
      secretValues: [secret],
    });
    expect(result.text).toBe(
      `env holds ${REDACTED_PLACEHOLDER} twice: ${REDACTED_PLACEHOLDER}`,
    );
    expect(result.count).toBe(2);
    expect(result.redacted).toBe(true);
  });

  it("长度 < 6 的登记值不参与（避免误伤 true / 1 这类短值）", () => {
    const result = redactText("value=1 and true", {
      secretValues: ["1", "true"],
    });
    expect(result.text).toBe("value=1 and true");
    expect(result.redacted).toBe(false);
  });
});

describe("第三层：形态识别（键名无害也能识别）", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["OpenAI 风格", `key sk-${"a".repeat(24)} tail`],
    ["GitHub PAT", `token ghp_${"b".repeat(24)} tail`],
    ["AWS AKIA", "id AKIAIOSFODNN7EXAMPLE tail"],
    ["Slack", `xoxb-${"c".repeat(12)} tail`],
    ["Bearer", `Authorization: Bearer ${"d".repeat(24)} tail`],
    [
      "PEM 私钥块",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
    ],
    ["赋值形态", "DB_PASSWORD=hunter2"],
  ];

  for (const [label, input] of cases) {
    it(`${label} 被抹除`, () => {
      const result = redactText(input);
      expect(result.redacted).toBe(true);
      expect(result.text).toContain(REDACTED_PLACEHOLDER);
      // 原始凭据片段不得残留
      expect(result.text).not.toMatch(
        /a{24}|b{24}|IOSFODNN7EXAMPLE|c{12}|d{24}|MIIEow|hunter2/,
      );
    });
  }

  it("赋值形态保留 KEY= 前缀，便于排障时知道是哪个变量", () => {
    const result = redactText("DB_PASSWORD=hunter2");
    expect(result.text).toBe(`DB_PASSWORD=${REDACTED_PLACEHOLDER}`);
  });
});

describe("顺序与边界：先脱敏、后截断", () => {
  it("截断发生在脱敏之后：秘密不会被切成半截留在文本里", () => {
    const secret = "supersecretvalue123";
    const text = `${"x".repeat(40)}${secret}${"y".repeat(40)}`;

    const result = redactText(text, {
      secretValues: [secret],
      maxStringLength: 50,
    });

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(50 + " [truncated]".length);
    // 关键断言：既无完整秘密，也无任何可识别的前缀碎片
    expect(result.text).not.toContain(secret);
    expect(result.text).not.toContain("supersecr");
  });

  it("超长文本标记 truncated，未超长不标记", () => {
    expect(redactText("short", { maxStringLength: 100 }).truncated).toBe(false);
    expect(
      redactText("a".repeat(101), { maxStringLength: 100 }).truncated,
    ).toBe(true);
  });

  it("数组与深度上限触发时标记 truncated", () => {
    const longArray = redactDeep(
      Array.from({ length: 300 }, (_, i) => i),
      {
        maxArrayLength: 200,
      },
    );
    expect(longArray.value).toHaveLength(200);
    expect(longArray.truncated).toBe(true);

    type Deep = { child?: Deep };
    let deep: Deep = {};
    const root: Deep = deep;
    for (let i = 0; i < 20; i += 1) {
      deep.child = {};
      deep = deep.child;
    }
    expect(redactDeep(root, { maxDepth: 3 }).truncated).toBe(true);
  });
});

describe("纯函数约束", () => {
  it("不修改入参（广播后调用方仍持有原始引用）", () => {
    const input = { token: "secret-value", keep: "as-is" };
    const result = redactDeep(input);
    expect(input.token).toBe("secret-value");
    expect(result.value).not.toBe(input);
    expect(result.value).toEqual({
      token: REDACTED_PLACEHOLDER,
      keep: "as-is",
    });
  });

  it("循环引用替换为 [Circular]，不抛错", () => {
    const cyclic: Record<string, unknown> = { name: "n" };
    cyclic["self"] = cyclic;
    const result = redactDeep(cyclic);
    expect((result.value as Record<string, unknown>)["self"]).toBe(
      "[Circular]",
    );
    expect((result.value as Record<string, unknown>)["name"]).toBe("n");
  });

  it("Date 归一为 ISO 字符串，函数/符号标记为占位", () => {
    const result = redactDeep({
      at: new Date("2026-01-01T00:00:00.000Z"),
      fn: () => 1,
    }) as unknown as { value: { at: string; fn: string } };
    expect(result.value.at).toBe("2026-01-01T00:00:00.000Z");
    expect(result.value.fn).toBe("[function]");
  });
});

describe("collectEnvironmentSecrets", () => {
  it("只收集敏感键名下长度足够的值", () => {
    const secrets = collectEnvironmentSecrets({
      API_KEY: "12345678",
      PATH: "/usr/bin:/bin",
      SHORT_TOKEN: "abc",
      NORMAL: "ordinary-value",
    });
    expect(secrets).toContain("12345678");
    expect(secrets).not.toContain("/usr/bin:/bin");
    expect(secrets).not.toContain("abc");
    expect(secrets).not.toContain("ordinary-value");
  });
});
