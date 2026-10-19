import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SUPERVISOR_PERMISSION_ERROR_CODE,
  SUPERVISOR_PRIVILEGED_ACTIONS,
  SupervisorPermissionDeniedError,
  assertSupervisorActionAllowed,
  createSupervisorControlPlane,
  createSupervisorViolationAuditor,
  toGatewayViolationPayload,
  type SupervisorViolationEvent,
} from "../../daemon/supervisor/permissions";

/**
 * TASK-S.1 / G-11b：Supervisor 运行时越权调用拦截。
 *
 * PASS 判据：调用 `approveContract` / `mergeContract` / `setVerdict` / `execCommand`
 * 100% 抛错被拒，并产生 `GATEWAY_VIOLATION` 审计事件；只读方法正常透传。
 */

const tmpDirs: string[] = [];

function newRepoDir(): string {
  const root = path.join(process.cwd(), ".tmp", "unit-supervisor");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "perm-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 沙箱可能拦截 unlink
    }
  }
});

function makeControlPlane() {
  return {
    getContract: vi.fn((contractId: string) => ({
      contract_id: contractId,
      lifecycle_state: "EXECUTING",
    })),
    listContracts: vi.fn(() => []),
    approveContract: vi.fn((_contractId?: string) => "APPROVED"),
    mergeContract: vi.fn((_contractId?: string) => "MERGED"),
    setVerdict: vi.fn((_contractId?: string) => "PASSED"),
    execCommand: vi.fn((_command?: string) => "stdout"),
    /** 未登记的未知方法：默认拒绝 */
    writeFile: vi.fn((_file?: string, _content?: string) => "written"),
    status: "idle" as const,
  };
}

describe("特权动作 100% 拒绝（G-11b 正例断言）", () => {
  it("4 类特权调用全部抛 E_UNAUTHORIZED_COMMAND，且原方法从未执行", () => {
    const repo = newRepoDir();
    const auditor = createSupervisorViolationAuditor({ repoRoot: repo });
    const plane = makeControlPlane();
    const view = createSupervisorControlPlane(plane, {
      audit: auditor.record,
      contractId: "c-g11b",
      sessionId: "ses_g11b0000000001",
    });

    expect(SUPERVISOR_PRIVILEGED_ACTIONS).toHaveLength(4);

    for (const action of SUPERVISOR_PRIVILEGED_ACTIONS) {
      const fn = (
        view as unknown as Record<string, (...args: unknown[]) => unknown>
      )[action] as (...args: unknown[]) => unknown;

      expect(typeof fn).toBe("function");
      expect(() => fn("c-g11b")).toThrow(SupervisorPermissionDeniedError);
      try {
        fn("c-g11b");
      } catch (err) {
        const denied = err as SupervisorPermissionDeniedError;
        expect(denied.code).toBe(SUPERVISOR_PERMISSION_ERROR_CODE);
        expect(denied.code).toBe("E_UNAUTHORIZED_COMMAND");
        expect(denied.reason_code).toBe("UNAUTHORIZED_COMMAND");
        expect(denied.action).toBe(action);
        expect(denied.source).toBe("supervisor");
      }

      const original = plane[action as keyof typeof plane] as ReturnType<
        typeof vi.fn
      >;
      expect(original).not.toHaveBeenCalled();
    }

    const events = auditor.readAll();
    expect(events).toHaveLength(8); // 每个动作各调用两次（toThrow + 复查）
    expect(events.every((event) => event.type === "GATEWAY_VIOLATION")).toBe(
      true,
    );
    expect(events.every((event) => event.source === "supervisor")).toBe(true);
    expect(events.map((event) => event.action)).toEqual([
      "approveContract",
      "approveContract",
      "mergeContract",
      "mergeContract",
      "setVerdict",
      "setVerdict",
      "execCommand",
      "execCommand",
    ]);
    expect(events[0]?.contract_id).toBe("c-g11b");
    expect(events[0]?.session_id).toBe("ses_g11b0000000001");
    expect(events[0]?.message).toContain("blocked");
  });

  it("只读白名单方法正常透传（正例对照，避免「全部拒绝」蒙混过关）", () => {
    const repo = newRepoDir();
    const auditor = createSupervisorViolationAuditor({ repoRoot: repo });
    const plane = makeControlPlane();
    const view = createSupervisorControlPlane(plane, {
      audit: auditor.record,
    });

    expect(view.getContract("c-1")).toEqual({
      contract_id: "c-1",
      lifecycle_state: "EXECUTING",
    });
    expect(view.listContracts()).toEqual([]);
    expect(plane.getContract).toHaveBeenCalledWith("c-1");
    expect(auditor.readAll()).toHaveLength(0);
  });

  it("未登记方法默认拒绝（deny-by-default），并记录 GATEWAY_VIOLATION", () => {
    const repo = newRepoDir();
    const auditor = createSupervisorViolationAuditor({ repoRoot: repo });
    const plane = makeControlPlane();
    const view = createSupervisorControlPlane(plane, {
      audit: auditor.record,
    });

    expect(() => view.writeFile("a.ts", "x")).toThrow(
      SupervisorPermissionDeniedError,
    );
    expect(plane.writeFile).not.toHaveBeenCalled();

    const events = auditor.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("writeFile");
    expect(events[0]?.message).toContain("deny-by-default");
  });

  it("非函数数据属性可读（快照不构成执行能力），写入尝试被拒", () => {
    const repo = newRepoDir();
    const auditor = createSupervisorViolationAuditor({ repoRoot: repo });
    const plane = makeControlPlane();
    const view = createSupervisorControlPlane(plane, {
      audit: auditor.record,
    });

    expect(view.status).toBe("idle");
    expect(() => {
      (view as unknown as { status: string }).status = "hacked";
    }).toThrow(SupervisorPermissionDeniedError);
    expect(plane.status).toBe("idle");
  });

  it("审计通道故障时仍然拒绝（不得因审计失败而放行）", () => {
    const plane = makeControlPlane();
    const view = createSupervisorControlPlane(plane, {
      audit: () => {
        throw new Error("audit sink down");
      },
    });

    expect(() => view.approveContract("c-1")).toThrow(
      SupervisorPermissionDeniedError,
    );
    expect(plane.approveContract).not.toHaveBeenCalled();
  });

  it("直接断言入口同样拒绝并留痕（供非 Proxy 调用点复用）", () => {
    const events: SupervisorViolationEvent[] = [];
    expect(() =>
      assertSupervisorActionAllowed("setVerdict", {
        audit: (event) => events.push(event),
        contractId: "c-direct",
      }),
    ).toThrow(SupervisorPermissionDeniedError);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("setVerdict");

    expect(() =>
      assertSupervisorActionAllowed("getContract", {
        audit: (event) => events.push(event),
      }),
    ).not.toThrow();
    expect(events).toHaveLength(1);
  });
});

describe("GATEWAY_VIOLATION 审计落盘", () => {
  it("JSONL 追加写、文件 0600、每条事件可解析且可转 IPC 载荷", () => {
    const repo = newRepoDir();
    const broadcasted: SupervisorViolationEvent[] = [];
    const auditor = createSupervisorViolationAuditor({
      repoRoot: repo,
      sink: (event) => broadcasted.push(event),
    });
    const plane = makeControlPlane();
    const view = createSupervisorControlPlane(plane, {
      audit: auditor.record,
      contractId: "c-audit",
      clock: () => new Date("2026-10-20T01:02:03.000Z"),
    });

    expect(() => view.execCommand("rm -rf /")).toThrow(
      SupervisorPermissionDeniedError,
    );
    expect(() => view.mergeContract("c-audit")).toThrow(
      SupervisorPermissionDeniedError,
    );

    expect(fs.existsSync(auditor.filePath)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(auditor.filePath).mode & 0o777).toBe(0o600);
    }

    const lines = fs
      .readFileSync(auditor.filePath, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(2);
    const parsed = lines.map(
      (line) => JSON.parse(line) as SupervisorViolationEvent,
    );
    expect(parsed[0]?.occurred_at).toBe("2026-10-20T01:02:03.000Z");
    expect(parsed.map((event) => event.action)).toEqual([
      "execCommand",
      "mergeContract",
    ]);
    expect(broadcasted).toHaveLength(2);

    const payload = toGatewayViolationPayload(
      parsed[0] as SupervisorViolationEvent,
    );
    expect(payload).toEqual({
      source: "supervisor",
      action: "execCommand",
      message: expect.stringContaining("blocked"),
      contract_id: "c-audit",
    });
    expect(auditor.readAll()).toHaveLength(2);
  });
});
