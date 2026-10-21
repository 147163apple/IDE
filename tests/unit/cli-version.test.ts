import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { formatVersion, readCliVersion } from "../../bin/version";
import { parseArgs } from "../../bin/stagent";

/**
 * CLI 版本展示（TASK-E.2 自举演练产物）。
 * 断言重点：版本号来自 package.json 而非硬编码；异常输入不得冒充版本。
 */
describe("stagent CLI 版本展示", () => {
  it("默认读取真实 package.json，且为合法 semver", () => {
    const version = readCliVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version?: string };
    expect(version).toBe(pkg.version);
  });

  it("version 子命令被 parseArgs 识别，不再回退 help", () => {
    expect(parseArgs(["version"]).command).toBe("version");
  });

  it("展示格式统一为 Stagent v<version>", () => {
    expect(formatVersion("0.1.0")).toBe("Stagent v0.1.0");
  });

  it("文件缺失 / 非法版本 / 损坏 JSON 时降级为 0.0.0 而不抛错", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-cli-version-"));
    try {
      expect(readCliVersion(path.join(dir, "missing.json"))).toBe("0.0.0");
      const bad = path.join(dir, "bad.json");
      fs.writeFileSync(bad, JSON.stringify({ version: "not-a-version" }));
      expect(readCliVersion(bad)).toBe("0.0.0");
      const broken = path.join(dir, "broken.json");
      fs.writeFileSync(broken, "{ not json");
      expect(readCliVersion(broken)).toBe("0.0.0");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
