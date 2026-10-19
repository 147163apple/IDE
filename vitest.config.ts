import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
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
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
