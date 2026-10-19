import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 单次随机会话 Token（规范 TASK-D.1 PASS-2）：
 * - 写入 `.stagent/session-token`，权限 0600
 * - 与 `.stagent/stagent.pid`（仅进程元数据）严格分离
 */
export const SESSION_TOKEN_FILENAME = "session-token";

export function sessionTokenPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), ".stagent", SESSION_TOKEN_FILENAME);
}

export function createSessionToken(repoRoot: string): string {
  const dir = path.join(path.resolve(repoRoot), ".stagent");
  fs.mkdirSync(dir, { recursive: true });

  const token = randomBytes(32).toString("hex");
  const filePath = sessionTokenPath(repoRoot);
  fs.writeFileSync(filePath, token, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows 无 Unix 权限位，忽略
  }
  return token;
}

export function readSessionToken(repoRoot: string): string | null {
  try {
    const token = fs.readFileSync(sessionTokenPath(repoRoot), "utf-8").trim();
    return token || null;
  } catch {
    return null;
  }
}

export function clearSessionToken(repoRoot: string): void {
  try {
    fs.unlinkSync(sessionTokenPath(repoRoot));
  } catch {
    // 已不存在则忽略
  }
}

/** 常量时间比较，避免时序侧信道 */
export function verifySessionToken(
  candidate: string | null | undefined,
  expected: string | null,
): boolean {
  if (!candidate || !expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Origin 校验（PASS-3）：仅允许本地回环来源；无 Origin 的非浏览器客户端
 * 仍需通过 Token 校验（CLI / 测试客户端）。
 */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}
