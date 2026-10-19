/**
 * 全局测试 setup。
 *
 * 本仓库默认测试环境为 `node`（daemon / lib / integration / e2e 共 33 个文件），
 * 仅组件与 hook 测试通过文件头 `// @vitest-environment jsdom` 显式声明 DOM 环境。
 *
 * 原因：jsdom 环境在本机每个 worker 的启动开销约 15~17s（实测 environment 累计
 * 32~34s / 2 workers），全量 38 文件并发时会把 worker 握手拖过 vitest 默认超时，
 * 表现为 `Timeout waiting for worker to respond`。因此 setup 必须对无 DOM 环境安全。
 */
import "@testing-library/jest-dom/vitest";

const hasDom = typeof window !== "undefined";

if (hasDom) {
  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: () => {},
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
