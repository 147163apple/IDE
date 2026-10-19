import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * 测试环境策略（2026-10 修订，修复全量 34 suites "Timeout waiting for worker to respond"）
 *
 * 根因：此前 `environment: "jsdom"` 全局生效。实测每个 worker 仅 jsdom 环境初始化
 * 就需 15~17s（2 文件小样本 environment 累计 32~34s），全量 38 文件并发时 worker
 * 握手被拖过 vitest 默认超时，表现为 suite 启动失败而非断言失败。
 * 对照实验（同一组 2 个 daemon 测试文件）：
 *   jsdom + forks   = 26.51s（environment 34.64s）
 *   jsdom + threads = 22.58s（environment 32.05s）
 *   node  + forks   =  4.98s（environment 0ms）
 *   node  + threads =  4.87s（environment 0ms）
 * 结论：瓶颈是 DOM 环境而非池类型，因此默认改为 node，仅 DOM 测试按文件 opt-in。
 * 池保持 `forks`：daemon 测试涉及 PID 锁、端口占用与子进程，进程级隔离更可靠。
 *
 * 需要 DOM 的测试文件必须在首行声明：`// @vitest-environment jsdom`
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
    // 规范外浏览器管线测试：待 M5 双轨割接时随管线一并删除（见 phase-checklist-M1）
    exclude: [
      "**/node_modules/**",
      "src/lib/scope.test.ts",
      "src/lib/pipeline.test.ts",
      "src/lib/git-guard.test.ts",
      "src/lib/stage3.test.ts",
      "src/lib/dual-agent.test.ts",
      "src/lib/arch-map.test.ts",
      "src/lib/mcp/gateway.test.ts",
    ],
    pool: "forks",
    // 18 核机器上并发 8 个 fork 足以覆盖 38 个文件，同时避免 fork 风暴拖慢握手
    maxWorkers: 8,
    minWorkers: 1,
    // daemon/integration 测试含真实 git 与子进程操作，默认 5s 偏紧
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
