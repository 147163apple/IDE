import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatSessionManager } from "../../daemon/chat/session-manager";
import type {
  AdapterEvent,
  AdapterRunInput,
  ChatAdapter,
} from "../../daemon/chat/types";
import type { ChatEvent } from "../../src/lib/chat-events";
import { createDaemon, type StagentDaemon } from "../../daemon/server";

/** 可控假适配器：按 tick 吐字，记录收到的 nativeSessionId / history */
class FakeAdapter implements ChatAdapter {
  calls: AdapterRunInput[] = [];
  stoppedAt: number | null = null;
  constructor(
    private readonly words = 50,
    private readonly tickMs = 20,
    /** 模拟不听话的适配器：abort 后仍继续吐字 */
    private readonly ignoreAbort = false,
  ) {}
  info() {
    return {
      id: "fake",
      label: "fake",
      control_mode: "GATEWAY_ENFORCED" as const,
      verified_on: "",
      available: true,
    };
  }
  async *run(input: AdapterRunInput): AsyncIterable<AdapterEvent> {
    this.calls.push(input);
    if (!input.nativeSessionId)
      yield { kind: "session", native_session_id: "native-123" };
    yield {
      kind: "tool_call",
      tool_id: "t1",
      name: "Edit",
      input: { file_path: "a.ts" },
    };
    yield { kind: "tool_result", tool_id: "t1", output: "ok", is_error: false };
    for (let i = 0; i < this.words; i++) {
      if (input.signal.aborted && !this.ignoreAbort) {
        this.stoppedAt = Date.now();
        return;
      }
      yield { kind: "delta", text: `w${i} ` };
      await new Promise((r) => setTimeout(r, this.tickMs));
    }
  }
}

describe("TASK-C.6 会话管理器", () => {
  let repo: string;
  let events: ChatEvent[];
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-chat-"));
    events = [];
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  const make = (adapter: ChatAdapter) =>
    new ChatSessionManager({
      repoRoot: repo,
      adapters: [adapter],
      publish: (e) => events.push(e),
    });

  it("流式输出：user → tool_call → tool_result → delta… → turn_end，首字 ≤1s", async () => {
    const m = make(new FakeAdapter(5, 1));
    const s = m.createSession("fake");
    const t0 = Date.now();
    m.send(s.id, "你好");
    await m.idle(s.id);
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("user");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(kinds.filter((k) => k === "delta")).toHaveLength(5);
    expect(kinds.at(-1)).toBe("turn_end");
    const firstDelta = events.find((e) => e.kind === "delta");
    expect(new Date(firstDelta!.at).getTime() - t0).toBeLessThan(1000);
  });

  it("打断：立即发 interrupted，之后 0 条输出，适配器 2s 内停止", async () => {
    const adapter = new FakeAdapter(1000, 10);
    const m = make(adapter);
    const s = m.createSession("fake");
    m.send(s.id, "长任务");
    await new Promise((r) => setTimeout(r, 100));
    const t = Date.now();
    expect(m.interrupt(s.id)).toBe(true);
    const idx = events.findIndex((e) => e.kind === "interrupted");
    await m.idle(s.id);
    expect(events.slice(idx + 1)).toHaveLength(0);
    expect(adapter.stoppedAt! - t).toBeLessThan(2000);
    expect(m.getSession(s.id)?.busy).toBe(false);
  });

  it("不听话的适配器：打断后迟到输出被门闩丢弃", async () => {
    const m = make(new FakeAdapter(30, 5, true));
    const s = m.createSession("fake");
    m.send(s.id, "x");
    await new Promise((r) => setTimeout(r, 40));
    m.interrupt(s.id);
    const idx = events.findIndex((e) => e.kind === "interrupted");
    await m.idle(s.id);
    expect(events.slice(idx + 1)).toHaveLength(0);
  });

  it("忙时排队，本轮结束后自动执行下一条", async () => {
    const adapter = new FakeAdapter(3, 5);
    const m = make(adapter);
    const s = m.createSession("fake");
    expect(m.send(s.id, "第一条")).toBe("started");
    expect(m.send(s.id, "第二条")).toBe("queued");
    await m.idle(s.id);
    expect(adapter.calls.map((c) => c.prompt)).toEqual(["第一条", "第二条"]);
    expect(events.filter((e) => e.kind === "turn_end")).toHaveLength(2);
  });

  it("重启续接：新管理器读取 .stagent/sessions，原生会话 ID 与上下文都在", async () => {
    const m1 = make(new FakeAdapter(2, 1));
    const s = m1.createSession("fake");
    m1.send(s.id, "记住 42");
    await m1.idle(s.id);
    await m1.shutdown();
    expect(
      fs.existsSync(path.join(repo, ".stagent", "sessions", `${s.id}.json`)),
    ).toBe(true);

    const adapter2 = new FakeAdapter(2, 1);
    const m2 = make(adapter2);
    expect(m2.listSessions().map((x) => x.id)).toContain(s.id);
    expect(m2.getSession(s.id)?.native_session_id).toBe("native-123");
    m2.send(s.id, "刚才是几？");
    await m2.idle(s.id);
    expect(adapter2.calls[0]?.nativeSessionId).toBe("native-123");
    expect(adapter2.calls[0]?.history[0]).toEqual({
      role: "user",
      text: "记住 42",
    });
    expect(adapter2.calls[0]?.history[1]?.role).toBe("assistant");
  });

  it("会话模块不引用 Supervisor（会话期间 Supervisor 零模型调用）", () => {
    const dir = path.join(process.cwd(), "daemon", "chat");
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["'][^"']*supervisor/);
    }
  });
});

describe("TASK-C.6 会话 HTTP + WS 帧", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("创建会话、发消息、打断，未鉴权 401", async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-chat-http-"));
    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3690,
      endPort: 3699,
      enableCrashRecovery: false,
      chatAdapters: [new FakeAdapter(500, 10)],
    });
    const info = await daemon.start();
    const base = `http://127.0.0.1:${info.port}`;
    const h = {
      authorization: `Bearer ${daemon.getSessionToken()}`,
      "content-type": "application/json",
    };
    expect((await fetch(`${base}/api/chat/sessions`)).status).toBe(401);
    const adapters = await (
      await fetch(`${base}/api/chat/adapters`, { headers: h })
    ).json();
    expect(adapters.adapters[0].id).toBe("fake");
    const created = await (
      await fetch(`${base}/api/chat/sessions`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ adapter_id: "fake" }),
      })
    ).json();
    const id = created.session.id as string;
    const sent = await fetch(`${base}/api/chat/sessions/${id}/messages`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ text: "hi" }),
    });
    expect(sent.status).toBe(202);
    await new Promise((r) => setTimeout(r, 80));
    const intr = await (
      await fetch(`${base}/api/chat/sessions/${id}/interrupt`, {
        method: "POST",
        headers: h,
      })
    ).json();
    expect(intr.interrupted).toBe(true);
    await daemon.chat.idle(id);
    const detail = await (
      await fetch(`${base}/api/chat/sessions/${id}`, { headers: h })
    ).json();
    expect(detail.session.events.at(-1).kind).toBe("interrupted");
  });
});
