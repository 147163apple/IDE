import { describe, expect, it } from "vitest";
import {
  defaultMarkdownViewMode,
  isMarkdownPath,
} from "../../src/lib/markdown-file";

describe("TASK-C.10j markdown-file helpers", () => {
  it("识别 .md / .markdown / .mdx（大小写不敏感）", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("docs/A.MD")).toBe(true);
    expect(isMarkdownPath("notes.markdown")).toBe(true);
    expect(isMarkdownPath("x.mdx")).toBe(true);
    expect(isMarkdownPath("src/a.ts")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
    expect(isMarkdownPath(".md")).toBe(false);
  });

  it(".md 默认预览，其它默认源码", () => {
    expect(defaultMarkdownViewMode("README.md")).toBe("preview");
    expect(defaultMarkdownViewMode("src/a.ts")).toBe("source");
  });
});
