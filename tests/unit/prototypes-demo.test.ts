/**
 * TASK-C.11b：Demo 落盘 .stagent/prototypes + 确认门禁
 */
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDemoConfirmedForWrite,
  buildMinimalPrototypeDemo,
  confirmDemoPrototype,
  prototypeRelativeRoot,
  writePrototype,
} from "../../daemon/supervisor/demo/prototypes";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    safeRmSync(d);
  }
});

describe("TASK-C.11b prototypes", () => {
  it("writes under .stagent/prototypes/<id>/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-proto-"));
    dirs.push(root);
    const demo = buildMinimalPrototypeDemo("会员 Demo");
    const result = writePrototype(root, "member-demo", demo);
    expect(result.relative_root).toBe(prototypeRelativeRoot("member-demo"));
    expect(
      fs.existsSync(path.join(root, result.relative_root, "index.html")),
    ).toBe(true);
    expect(() =>
      assertDemoConfirmedForWrite(root, result.prototype_id),
    ).toThrow(/未确认 Demo/);
    confirmDemoPrototype(root, result.prototype_id);
    expect(() =>
      assertDemoConfirmedForWrite(root, result.prototype_id),
    ).not.toThrow();
  });

  it("allows skip_demo bypass", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-proto-"));
    dirs.push(root);
    expect(() =>
      assertDemoConfirmedForWrite(root, undefined, { skip_demo: true }),
    ).not.toThrow();
  });
});
