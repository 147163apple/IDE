/**
 * TASK-H.1：非法 JSON → 可识别错误 + 正好 1 次重试；合法 patch → 零重试。
 */
import { describe, expect, it, vi } from "vitest";
import {
  E_WORKER_PARSE,
  parseWorkerPatch,
  withParseRetry,
  WorkerParseError,
} from "../../daemon/worker/parse-worker-output";

describe("TASK-H.1 worker parse + retry", () => {
  it("合法最小 patch → 一次解析成功、零重试", async () => {
    const onRetry = vi.fn();
    const { value, retriesUsed } = await withParseRetry(
      async () => ({
        changes: [{ path: "README.md", content: "hi" }],
        log: ["ok"],
      }),
      (raw, retriesUsed) => parseWorkerPatch(raw, { retriesUsed }),
      { onRetry },
    );
    expect(retriesUsed).toBe(0);
    expect(onRetry).not.toHaveBeenCalled();
    expect(value.changes).toHaveLength(1);
    expect(value.changes[0]?.path).toBe("README.md");
  });

  it("注入非法 JSON → 可识别错误码且正好 1 次重试钩子，进程不挂起", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await expect(
      withParseRetry(
        async () => {
          calls += 1;
          return "{not-json";
        },
        (raw, retriesUsed) => parseWorkerPatch(raw, { retriesUsed }),
        { onRetry },
      ),
    ).rejects.toMatchObject({
      code: E_WORKER_PARSE,
      name: "WorkerParseError",
    });
    expect(calls).toBe(2); // 首次 + 1 次重试
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("首次非法、重试合法 → 成功且 retriesUsed=1", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const { value, retriesUsed } = await withParseRetry(
      async () => {
        calls += 1;
        if (calls === 1) return "not-json<<<";
        return {
          changes: [{ path: "a.ts", content: "export {};" }],
          log: ["retry ok"],
        };
      },
      (raw, retriesUsed) => parseWorkerPatch(raw, { retriesUsed }),
      { onRetry },
    );
    expect(retriesUsed).toBe(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(value.log[0]).toBe("retry ok");
  });

  it("缺 path 字段 → WorkerParseError", () => {
    expect(() =>
      parseWorkerPatch({ changes: [{ content: "x" }], log: [] }),
    ).toThrow(WorkerParseError);
  });

  it("支持 markdown 围栏 JSON", () => {
    const patch = parseWorkerPatch(
      '```json\n{"changes":[{"path":"x","content":"y"}],"log":[]}\n```',
    );
    expect(patch.changes[0]?.path).toBe("x");
  });
});
