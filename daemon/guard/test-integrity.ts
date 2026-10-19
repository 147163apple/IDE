/**
 * 测试文件防篡改（Test Integrity Guard）。
 *
 * 威胁模型：Worker（LLM）修复失败时的经典作弊路径是修改测试断言、
 * 把 it() 改成 it.skip()，让验证命令退出码归零、Evidence 显示 PASSED。
 * 退出码只证明「命令跑完了」，不证明「测试没被考生自己改过」。
 *
 * 规则：
 * 1. 测试文件的写操作要求 writable_paths 中存在「显式指向测试代码」的模式
 *    （如 tests/**、**／*.test.ts）；仅被 src/** 这类宽泛模式覆盖不够。
 * 2. 即使合同显式授权了测试文件，Evidence 也必须记录 tests_modified: true，
 *    供核销人在控制台高亮预警中人工复核。
 */

const TEST_DIR_SEGMENTS = new Set(["tests", "test", "__tests__"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.[^/]+$/;

function normalize(relPath: string): string {
  return relPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/)+/, "");
}

/** 判断相对路径是否为测试文件（tests/、test/、__tests__/ 目录或 *.test.* / *.spec.* 文件） */
export function isTestPath(relPath: string): boolean {
  const normalized = normalize(relPath);
  if (!normalized) return false;
  const segments = normalized.split("/");
  if (
    segments
      .slice(0, -1)
      .some((segment) => TEST_DIR_SEGMENTS.has(segment.toLowerCase()))
  ) {
    return true;
  }
  const basename = segments[segments.length - 1] ?? "";
  return TEST_FILE_PATTERN.test(basename.toLowerCase());
}

/**
 * writable_paths 中是否存在「显式指向测试代码」的模式。
 * 仅 `src/**` 这类宽泛模式不算显式授权；必须出现 tests/test/__tests__
 * 目录段，或 .test. / .spec. 文件模式。
 */
export function scopeExplicitlyIncludesTests(writablePaths: string[]): boolean {
  return writablePaths.some((raw) => {
    const pattern = normalize(raw).toLowerCase();
    if (!pattern) return false;
    if (pattern.includes(".test.") || pattern.includes(".spec.")) return true;
    return /(^|\/)(tests?|__tests__)(\/|$)/.test(pattern);
  });
}
