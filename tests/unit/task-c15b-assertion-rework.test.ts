/**
 * TASK-C.15b / EO-08：UUIDv5 assertion_id + 返工计数 + 返工期禁追加。
 */
import { describe, expect, it } from "vitest";
import {
  assertionIdFromText,
  ReworkCounter,
  MAX_REWORK_COUNT,
} from "../../daemon/guard/assertion-identity";

describe("TASK-C.15b EO-08 assertion identity", () => {
  it("同文本 → 同 UUIDv5；不同文本 → 不同 id", () => {
    const a = assertionIdFromText("用户能登录");
    const b = assertionIdFromText("用户能登录");
    const c = assertionIdFromText("用户能注册");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("返工计数权威；超限 escalated", () => {
    const counter = new ReworkCounter("c-test");
    const [id] = counter.registerAssertions(["按钮可点"]);
    counter.enterRework();
    counter.recordFailure(id!);
    counter.recordFailure(id!);
    expect(counter.snapshot().counts[id!]).toBe(2);
    const snap = counter.recordFailure(id!); // 3 > MAX(2)
    expect(snap.phase).toBe("escalated");
    expect(counter.isEscalated).toBe(true);
    expect(MAX_REWORK_COUNT).toBe(2);
  });

  it("返工期禁止追加新断言", () => {
    const counter = new ReworkCounter("c-test");
    counter.registerAssertions(["旧断言"]);
    counter.enterRework();
    expect(() => counter.tryAddAssertion("新需求断言")).toThrow(
      /返工期严禁追加/,
    );
  });

  it("自编未知 assertion_id 拒绝", () => {
    const counter = new ReworkCounter("c-test");
    counter.registerAssertions(["合法"]);
    expect(() =>
      counter.recordFailure("00000000-0000-5000-8000-000000000000"),
    ).toThrow(/未知 assertion_id/);
  });
});
