/**
 * TASK-H.7：主链路回归清单与指纹（供脚本与单测共用）。
 */
export const MAINLINE_NODES = [
  "open",
  "baseline_dirty",
  "draft_demo",
  "sign",
  "execute",
  "verify",
  "merged",
  "dispute_gray",
  "rework_limit",
  "porcelain_trim",
] as const;

export type MainlineNode = (typeof MAINLINE_NODES)[number];

/** 锁死不得静默删除的回归指纹文件 */
export const REGRESSION_FINGERPRINT = [
  "tests/daemon/porcelain-leading-space.test.ts",
  "tests/unit/task-h1-worker-parse-retry.test.ts",
  "tests/unit/task-h2-terminal-state-closure.test.ts",
  "tests/unit/task-h3-scan-hard-cap.test.ts",
  "tests/unit/task-h4-empty-dir-git-init.test.ts",
  "tests/unit/task-c15b-rework-live-path.test.ts",
  "tests/unit/dispute-gray.test.ts",
  "tests/unit/task-h7-mainline-regression.test.ts",
] as const;
