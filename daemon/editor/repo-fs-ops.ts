import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveSafeWorktreePath } from "../mcp/path-resolver";
import { matchProtected } from "../protection/protection-list";
import { SYSTEM_SEGMENTS } from "./worktree-files";

/**
 * TASK-C.10i：资源管理器第一批文件系统操作（用户主动）。
 * - 鉴权由 HTTP 层保证；本模块：路径安全 + P.1 保护清单 + 白话结果。
 * - create：新建文件 / 空文件夹
 * - rename：重命名（同目录改名或改相对路径，禁止穿越）
 * - reveal：在 Finder / 文件管理器中显示
 */

export type FsOpsFail = {
  ok: false;
  code: string;
  message: string;
  httpStatus: number;
};

export type CreateRepoPathOutcome =
  { ok: true; path: string; kind: "file" | "dir"; message: string } | FsOpsFail;

export type RenameRepoPathOutcome =
  { ok: true; from: string; to: string; message: string } | FsOpsFail;

export type RevealRepoPathOutcome =
  { ok: true; path: string; message: string } | FsOpsFail;

function fail(code: string, message: string, httpStatus: number): FsOpsFail {
  return { ok: false, code, message, httpStatus };
}

function rejectSystemSegments(rel: string): FsOpsFail | null {
  const segs = rel.split(/[\\/]/).filter(Boolean);
  if (segs.some((s) => SYSTEM_SEGMENTS.includes(s))) {
    return fail(
      "E_SYSTEM_PATH",
      "系统目录（.git / .stagent）不能在资源管理器里改动。",
      403,
    );
  }
  return null;
}

function checkProtection(
  protectionRoot: string,
  relPath: string,
  actionLabel: string,
): FsOpsFail | null {
  try {
    const hit = matchProtected(protectionRoot, relPath);
    if (hit.hit) {
      const name = hit.entryName ?? "受保护文件";
      return fail(
        "PROTECTED_PATH",
        hit.selfLock
          ? "保护清单本身不能改动（自锁）。请在「项目审阅 / 保护」里用界面改清单。"
          : `「${name}」在保护清单里，不能${actionLabel}。请先在保护设置里拿掉对应项，或走助手授权流程。`,
        403,
      );
    }
  } catch (err) {
    return fail(
      "PROTECTED_PATH",
      `保护门卫读清单失败，按拒绝处理：${(err as Error).message}`,
      403,
    );
  }
  return null;
}

function validateLeafName(name: string): FsOpsFail | null {
  const n = name.trim();
  if (!n) {
    return fail("INVALID_INPUT", "请输入名称。", 400);
  }
  if (n === "." || n === ".." || n.includes("/") || n.includes("\\")) {
    return fail(
      "INVALID_INPUT",
      "名称里不能有斜杠，也不能是「.」或「..」。",
      400,
    );
  }
  if (SYSTEM_SEGMENTS.includes(n)) {
    return fail("E_SYSTEM_PATH", `不能使用系统名「${n}」。`, 403);
  }
  return null;
}

/** parentRel 为空或 "." 表示仓库根；name 为单段文件/文件夹名 */
export function createRepoPath(args: {
  protectionRoot: string;
  fileRoot: string;
  parentRel: string;
  name: string;
  kind: "file" | "dir";
}): CreateRepoPathOutcome {
  const nameErr = validateLeafName(args.name);
  if (nameErr) return nameErr;

  const parentRaw = String(args.parentRel ?? "").trim();
  const parentRel =
    !parentRaw || parentRaw === "." || parentRaw === "/"
      ? ""
      : parentRaw.replace(/^\/+|\/+$/g, "");
  const relPath = parentRel
    ? `${parentRel}/${args.name.trim()}`
    : args.name.trim();

  let safe;
  try {
    safe = resolveSafeWorktreePath(args.fileRoot, relPath);
  } catch (err) {
    return fail(
      "PATH_TRAVERSAL_DETECTED",
      `路径不安全，已拒绝新建：${(err as Error).message}`,
      400,
    );
  }

  const sys = rejectSystemSegments(safe.relativePath);
  if (sys) return sys;

  const prot = checkProtection(args.protectionRoot, safe.relativePath, "新建");
  if (prot) return prot;

  if (fs.existsSync(safe.absolutePath)) {
    return fail("E_EXISTS", `「${safe.relativePath}」已经存在。`, 409);
  }

  try {
    if (parentRel) {
      const parentSafe = resolveSafeWorktreePath(args.fileRoot, parentRel);
      if (!fs.existsSync(parentSafe.absolutePath)) {
        return fail(
          "ENOENT",
          `找不到父文件夹「${parentSafe.relativePath}」。`,
          404,
        );
      }
      if (!fs.statSync(parentSafe.absolutePath).isDirectory()) {
        return fail(
          "E_NOT_A_DIR",
          `「${parentSafe.relativePath}」不是文件夹，不能在里面新建。`,
          400,
        );
      }
    }
    if (args.kind === "dir") {
      fs.mkdirSync(safe.absolutePath, { recursive: false });
    } else {
      fs.mkdirSync(path.dirname(safe.absolutePath), { recursive: true });
      fs.writeFileSync(safe.absolutePath, "", "utf8");
    }
  } catch (err) {
    return fail("EIO", `新建失败：${(err as Error).message}`, 400);
  }

  return {
    ok: true,
    path: safe.relativePath,
    kind: args.kind,
    message:
      args.kind === "dir"
        ? `已新建文件夹「${safe.relativePath}」。`
        : `已新建文件「${safe.relativePath}」。`,
  };
}

export function renameRepoPath(args: {
  protectionRoot: string;
  fileRoot: string;
  fromRel: string;
  toRel: string;
}): RenameRepoPathOutcome {
  const fromRaw = String(args.fromRel ?? "").trim();
  const toRaw = String(args.toRel ?? "").trim();
  if (!fromRaw || !toRaw) {
    return fail("INVALID_INPUT", "请指定原路径和新路径。", 400);
  }

  let fromSafe;
  let toSafe;
  try {
    fromSafe = resolveSafeWorktreePath(args.fileRoot, fromRaw);
    toSafe = resolveSafeWorktreePath(args.fileRoot, toRaw);
  } catch (err) {
    return fail(
      "PATH_TRAVERSAL_DETECTED",
      `路径不安全，已拒绝重命名：${(err as Error).message}`,
      400,
    );
  }

  const leaf = path.basename(toSafe.relativePath);
  const nameErr = validateLeafName(leaf);
  if (nameErr) return nameErr;

  const sysFrom = rejectSystemSegments(fromSafe.relativePath);
  if (sysFrom) return sysFrom;
  const sysTo = rejectSystemSegments(toSafe.relativePath);
  if (sysTo) return sysTo;

  const protFrom = checkProtection(
    args.protectionRoot,
    fromSafe.relativePath,
    "重命名",
  );
  if (protFrom) return protFrom;
  const protTo = checkProtection(
    args.protectionRoot,
    toSafe.relativePath,
    "改成这个名字",
  );
  if (protTo) return protTo;

  if (!fs.existsSync(fromSafe.absolutePath)) {
    return fail(
      "ENOENT",
      `找不到「${fromSafe.relativePath}」，可能已被删或改名。`,
      404,
    );
  }
  if (fs.existsSync(toSafe.absolutePath)) {
    return fail("E_EXISTS", `「${toSafe.relativePath}」已经存在。`, 409);
  }

  try {
    const parent = path.dirname(toSafe.absolutePath);
    if (!fs.existsSync(parent)) {
      return fail("ENOENT", `目标父文件夹不存在，请先新建文件夹。`, 404);
    }
    fs.renameSync(fromSafe.absolutePath, toSafe.absolutePath);
  } catch (err) {
    return fail("EIO", `重命名失败：${(err as Error).message}`, 400);
  }

  return {
    ok: true,
    from: fromSafe.relativePath,
    to: toSafe.relativePath,
    message: `已将「${fromSafe.relativePath}」重命名为「${toSafe.relativePath}」。`,
  };
}

export function revealRepoPath(args: {
  fileRoot: string;
  relPath: string;
}): RevealRepoPathOutcome {
  const raw = String(args.relPath ?? "").trim();
  // 空路径 = 揭示仓库根
  const targetRel = !raw || raw === "." ? "." : raw;

  let safe;
  try {
    safe =
      targetRel === "."
        ? {
            relativePath: ".",
            absolutePath: path.resolve(args.fileRoot),
          }
        : resolveSafeWorktreePath(args.fileRoot, targetRel);
  } catch (err) {
    return fail(
      "PATH_TRAVERSAL_DETECTED",
      `路径不安全，已拒绝打开：${(err as Error).message}`,
      400,
    );
  }

  if (safe.relativePath !== ".") {
    const sys = rejectSystemSegments(safe.relativePath);
    if (sys) return sys;
  }

  if (!fs.existsSync(safe.absolutePath)) {
    return fail(
      "ENOENT",
      `找不到「${safe.relativePath === "." ? "项目根" : safe.relativePath}」。`,
      404,
    );
  }

  try {
    if (process.platform === "darwin") {
      execFileSync("open", ["-R", safe.absolutePath], {
        stdio: "ignore",
        timeout: 10_000,
      });
      return {
        ok: true,
        path: safe.relativePath,
        message: "已在 Finder 中显示。",
      };
    }
    // 非 Mac：打开父目录（尽力）
    const dir = fs.statSync(safe.absolutePath).isDirectory()
      ? safe.absolutePath
      : path.dirname(safe.absolutePath);
    if (process.platform === "win32") {
      execFileSync("explorer", ["/select,", safe.absolutePath], {
        stdio: "ignore",
        timeout: 10_000,
      });
    } else {
      execFileSync("xdg-open", [dir], {
        stdio: "ignore",
        timeout: 10_000,
      });
    }
    return {
      ok: true,
      path: safe.relativePath,
      message: "已在文件管理器中显示。",
    };
  } catch (err) {
    return fail(
      "E_REVEAL_FAILED",
      `没法在文件管理器中显示：${(err as Error).message}`,
      400,
    );
  }
}
