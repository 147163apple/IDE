import fs from "node:fs";
import path from "node:path";
import { StagentRuntimeError } from "../../../src/lib/error-codes";
import {
  DEMO_ENTRY,
  DEMO_MANIFEST,
  DEMO_ROOT,
  DemoSecurityError,
  MAX_DEMO_FILE_BYTES,
  byteLengthOf,
  normalizeDemoAssetPath,
  type DemoAsset,
  type GeneratedDemo,
} from "./types";

/**
 * TASK-S.4 / 架构 §4.4：Demo 静态原型生成器。
 *
 * 只做三件事：把已经收敛的需求文档摘要成页面结构、渲染成纯静态资源、
 * 在**落盘前**执行尺寸与路径检查。不接触模型、不联网、不读数据库。
 */

/** 需求摘要：只保留能稳定渲染的部分，避免把整篇 Markdown 原样塞进页面 */
export interface RequirementsDigest {
  readonly title: string;
  readonly sections: ReadonlyArray<{
    readonly heading: string;
    readonly bullets: readonly string[];
  }>;
  readonly formFields: ReadonlyArray<{
    readonly name: string;
    readonly label: string;
    readonly type: "text" | "email" | "password" | "number" | "textarea";
  }>;
}

const FIELD_HEADING_PATTERN = /(表单|字段|输入项)/;

function inferInputType(
  label: string,
): "text" | "email" | "password" | "number" | "textarea" {
  if (/邮箱|email|邮件/i.test(label)) return "email";
  if (/密码|password|口令/i.test(label)) return "password";
  if (/数量|金额|次数|价格|number|numeric/i.test(label)) return "number";
  if (/备注|描述|说明|textarea/i.test(label)) return "textarea";
  return "text";
}

/** 把标签转成稳定的字段名；非 ASCII 标签回退到序号，避免生成非法 name */
function toFieldName(label: string, index: number): string {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii.length > 0 ? ascii : `field_${index + 1}`;
}

/**
 * 从 requirements.md 提取标题、小节与表单字段。
 *
 * 约定（与 Supervisor 产出格式一致）：`#` 为标题、`##` 为小节、`-`/`*` 为条目；
 * 位于「表单 / 字段 / 输入项」小节下的条目视为表单字段。
 */
export function digestRequirements(markdown: string): RequirementsDigest {
  const lines = markdown.split(/\r?\n/);

  let title = "原型预览";
  const sections: Array<{ heading: string; bullets: string[] }> = [];
  type DemoFormField = RequirementsDigest["formFields"][number];
  const formFields: DemoFormField[] = [];
  let current: { heading: string; bullets: string[] } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      const heading = h1[1]?.trim();
      if (heading && title === "原型预览") {
        title = heading;
        continue;
      }
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const heading = h2[1]?.trim();
      if (heading) {
        current = { heading, bullets: [] };
        sections.push(current);
        continue;
      }
    }

    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      const text = bullet[1]?.trim();
      if (!text) continue;
      if (current) current.bullets.push(text);

      if (current && FIELD_HEADING_PATTERN.test(current.heading)) {
        formFields.push({
          name: toFieldName(text, formFields.length),
          label: text,
          type: inferInputType(text),
        });
      }
    }
  }

  return { title, sections, formFields };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderIndexHtml(digest: RequirementsDigest): string {
  const sectionCards = digest.sections
    .map(
      (section) => `
      <section class="card">
        <h2>${escapeHtml(section.heading)}</h2>
        <ul>${section.bullets
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>
      </section>`,
    )
    .join("");

  const fields = digest.formFields
    .map((field) => {
      const control =
        field.type === "textarea"
          ? `<textarea id="${field.name}" name="${field.name}" rows="3"></textarea>`
          : `<input id="${field.name}" name="${field.name}" type="${field.type}" />`;
      return `
        <label class="field">
          <span>${escapeHtml(field.label)}</span>
          ${control}
        </label>`;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(digest.title)} · 原型预览</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header>
      <h1>${escapeHtml(digest.title)}</h1>
      <p class="hint">这是纯静态原型：数据全部来自本地 Mock，不会写回你的项目。</p>
    </header>
    <main>
      ${sectionCards}
      <section class="card">
        <h2>交互表单（Mock）</h2>
        <form id="demo-form">
          ${fields || '<p class="hint">当前需求未提取到表单字段。</p>'}
          <button type="submit">模拟提交</button>
        </form>
        <pre id="result" hidden></pre>
      </section>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`;
}

function renderStyles(): string {
  return `:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f7f7f8; color: #1c1c1e;
}
header { margin-bottom: 24px; }
h1 { font-size: 22px; margin: 0 0 8px; }
h2 { font-size: 15px; margin: 0 0 12px; }
.hint { color: #6b6b70; font-size: 13px; margin: 0; }
main { display: grid; gap: 16px; max-width: 720px; }
.card { background: #fff; border: 1px solid #e5e5ea; border-radius: 10px; padding: 18px; }
ul { margin: 0; padding-left: 18px; }
li { margin: 4px 0; font-size: 14px; }
form { display: grid; gap: 12px; }
.field { display: grid; gap: 6px; font-size: 13px; }
.field input, .field textarea {
  width: 100%; padding: 8px 10px; font: inherit;
  border: 1px solid #d1d1d6; border-radius: 6px; background: #fff;
}
button {
  justify-self: start; padding: 8px 16px; font: inherit;
  border: 0; border-radius: 6px; background: #0a84ff; color: #fff; cursor: pointer;
}
pre { margin: 12px 0 0; padding: 12px; background: #f2f2f7; border-radius: 6px; font-size: 12px; overflow: auto; }
`;
}

function renderAppJs(digest: RequirementsDigest): string {
  // Mock 数据完全内嵌，页面不发出任何网络请求（CSP connect-src 'none' 亦兜底）
  const mock = {
    title: digest.title,
    fields: digest.formFields.map((field) => field.name),
    generated_at: "mock",
  };

  return `(function () {
  "use strict";
  var MOCK = ${JSON.stringify(mock)};

  var form = document.getElementById("demo-form");
  var result = document.getElementById("result");
  if (!form || !result) return;

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var data = {};
    MOCK.fields.forEach(function (name) {
      var el = form.elements.namedItem(name);
      if (el && "value" in el) data[name] = el.value;
    });
    // 仅本地演示：不调用任何 fetch / WebSocket，也不触碰父页面
    result.hidden = false;
    result.textContent = "已模拟提交（未发出任何网络请求）：\\n" + JSON.stringify(data, null, 2);
  });
})();
`;
}

/** 由需求文档生成一份纯静态、可预览的原型资源集合 */
export function buildDemoFromRequirements(markdown: string): GeneratedDemo {
  const digest = digestRequirements(markdown);
  const assets: DemoAsset[] = [
    { path: DEMO_ENTRY, content: renderIndexHtml(digest) },
    { path: "styles.css", content: renderStyles() },
    { path: "app.js", content: renderAppJs(digest) },
  ];

  // 生成阶段即做尺寸检查：宁可在此抛错，也不把超限内容带进写盘路径
  for (const asset of assets) assertAssetSize(asset);

  return {
    entry: DEMO_ENTRY,
    assets,
    totalBytes: assets.reduce(
      (sum, asset) => sum + byteLengthOf(asset.content),
      0,
    ),
  };
}

/**
 * 单文件尺寸闸门。
 *
 * 用 UTF-8 字节数而非 `String.length`：长度按 UTF-16 码元计，中文内容会被低估，
 * 一个"看起来 1.2MB"的中文页面实际可能已经超过 2MB 上限。
 */
export function assertAssetSize(asset: DemoAsset): void {
  const bytes = byteLengthOf(asset.content);
  if (bytes > MAX_DEMO_FILE_BYTES) {
    throw new StagentRuntimeError(
      "E_DEMO_PAYLOAD_TOO_LARGE",
      `Demo asset ${asset.path} is ${bytes} bytes, exceeds the ${MAX_DEMO_FILE_BYTES}-byte limit (TASK-S.4)`,
    );
  }
}

export interface WriteDemoResult {
  readonly root: string;
  readonly entryPath: string;
  readonly files: readonly string[];
  readonly totalBytes: number;
}

/**
 * 把原型资源写入受控目录（默认 `<repoRoot>/.stagent/demo`）。
 *
 * 写盘前逐项校验：路径语法安全 → 解析后仍在根目录内 → 单文件 ≤ 2MB。
 * 任一不满足即抛错且**不写入任何文件**（先全量校验，再统一落盘）。
 */
export function writeDemo(
  repoRoot: string,
  demo: GeneratedDemo,
  options: { rootDir?: string } = {},
): WriteDemoResult {
  const root = path.resolve(repoRoot, options.rootDir ?? DEMO_ROOT);
  const planned: Array<{ absPath: string; content: string }> = [];

  for (const asset of demo.assets) {
    const relative = normalizeDemoAssetPath(asset.path);
    assertAssetSize(asset);

    const absPath = path.resolve(root, relative);
    // 二次断言：即使语法检查被绕过，也不允许写到 Demo 根之外
    if (absPath !== root && !absPath.startsWith(root + path.sep)) {
      throw new DemoSecurityError(
        `Demo asset escapes the demo root: ${asset.path}`,
      );
    }
    planned.push({ absPath, content: asset.content });
  }

  fs.mkdirSync(root, { recursive: true });
  for (const item of planned) {
    fs.mkdirSync(path.dirname(item.absPath), { recursive: true });
    fs.writeFileSync(item.absPath, item.content, "utf8");
  }

  // 记录当前生效资源，供快照回退时精确清理残留文件
  const relativeFiles = demo.assets.map((asset) =>
    normalizeDemoAssetPath(asset.path),
  );
  fs.writeFileSync(
    path.join(root, DEMO_MANIFEST),
    JSON.stringify(
      { files: relativeFiles, updated_at: new Date().toISOString() },
      null,
      2,
    ),
    "utf8",
  );

  return {
    root,
    entryPath: path.join(root, demo.entry),
    files: planned.map((item) => item.absPath),
    totalBytes: demo.totalBytes,
  };
}
