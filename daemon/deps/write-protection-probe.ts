import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * 文件系统写保护前置探测（规范 TASK-A.3 PASS-2）。
 *
 * 目的：在建立「主目录 node_modules 只读视图」前，证明当前 OS/FS 确实会拦截
 * 对只读目录的写入。只有探测通过才允许共享依赖；否则必须降级为隔离安装。
 *
 * 方法：在目标目录下创建探针子目录 → 写入标记 → chmod 0555 → 尝试再写入：
 * - 写入被拒（EACCES/EPERM）→ proven
 * - 写入成功（root、Windows 目录只读位无效、某些网络 FS）→ 不可证明
 * 无论结果如何，finally 中恢复权限并删除探针，不污染仓库。
 */
export interface WriteProtectionProbe {
  proven: boolean;
  method: "chmod-deny" | "unavailable";
  checkedPath: string;
  reason?: string;
}

export async function probeWriteProtection(
  targetDir: string,
): Promise<WriteProtectionProbe> {
  const base = path.resolve(targetDir);
  let probeDir: string | null = null;

  try {
    fs.mkdirSync(base, { recursive: true });
    probeDir = path.join(
      base,
      `.stagent-wp-probe-${process.pid}-${randomBytes(4).toString("hex")}`,
    );
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, "marker"), "ok");

    fs.chmodSync(probeDir, 0o555);

    let denied = false;
    try {
      fs.writeFileSync(path.join(probeDir, "denied.txt"), "should fail");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      denied = code === "EACCES" || code === "EPERM";
      if (!denied) {
        return {
          proven: false,
          method: "unavailable",
          checkedPath: base,
          reason: `Unexpected error during write probe: ${(err as Error).message}`,
        };
      }
    }

    if (!denied) {
      return {
        proven: false,
        method: "unavailable",
        checkedPath: base,
        reason:
          "Filesystem allowed writes to a read-only directory (running as root, Windows ACL, or virtualized FS)",
      };
    }

    return { proven: true, method: "chmod-deny", checkedPath: base };
  } catch (err) {
    return {
      proven: false,
      method: "unavailable",
      checkedPath: base,
      reason: (err as Error).message,
    };
  } finally {
    if (probeDir) {
      try {
        fs.chmodSync(probeDir, 0o755);
      } catch {
        // ignore
      }
      try {
        fs.rmSync(probeDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
