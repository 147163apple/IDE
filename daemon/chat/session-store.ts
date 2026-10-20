import fs from "node:fs";
import path from "node:path";
import type { ChatEvent, ChatSessionDetail } from "../../src/lib/chat-events";

/** 会话持久化：`.stagent/sessions/<id>.json`（TASK-C.6 目标 4） */
export interface StoredSession extends Omit<ChatSessionDetail, "busy"> {
  events: ChatEvent[];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export class ChatSessionStore {
  readonly dir: string;

  constructor(repoRoot: string) {
    this.dir = path.join(repoRoot, ".stagent", "sessions");
  }

  private file(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`invalid session id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  list(): StoredSession[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: StoredSession[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        out.push(
          JSON.parse(
            fs.readFileSync(path.join(this.dir, name), "utf8"),
          ) as StoredSession,
        );
      } catch {
        // 损坏文件跳过，不影响其他会话
      }
    }
    return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  get(id: string): StoredSession | null {
    const f = this.file(id);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, "utf8")) as StoredSession;
  }

  save(session: StoredSession): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const f = this.file(session.id);
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
    fs.renameSync(tmp, f);
  }
}
