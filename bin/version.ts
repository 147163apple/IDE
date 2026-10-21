/**
 * CLI 版本展示（TASK-E.2 自举演练产物）。
 *
 * 版本号的唯一事实源是 package.json：把版本写死在代码里，发版时必然漂移。
 * 这里每次从磁盘读取，`stagent version` 与帮助抬头复用同一条路径。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 缺省读取位置：相对本模块，兼容 tsx 直跑与编译后布局 */
export const PACKAGE_JSON_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);

/** 版本号形态：与 package.json 的 semver 约定一致，异常值不冒充版本 */
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** 读版本号；文件缺失 / 损坏 / 非法一律降级为 0.0.0，绝不打断 CLI */
export function readCliVersion(
  packageJsonPath: string = PACKAGE_JSON_PATH,
): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    const version = parsed.version;
    return typeof version === "string" && SEMVER.test(version)
      ? version
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** 统一展示格式：`Stagent v0.1.0` */
export function formatVersion(version: string): string {
  return `Stagent v${version}`;
}
