/**
 * TASK-C.10c：工作台用户可见白话标签（与 C.8b「合同操作台」对齐）。
 * 内部 id（system:supervisor-studio 等）保持不变；只改对人说的话。
 */
export const WORKBENCH_LABEL = {
  /** 原 Supervisor 系统 Tab / ActivityBar */
  supervisor: "项目审阅",
  /** 原 Supervisor Studio；与顶栏「打开合同操作台」一致 */
  studio: "合同操作台",
  /** 原 SmartTerminal 底栏抽屉 */
  terminal: "验证输出",
  /** ActivityBar 文件树 */
  explorer: "资源管理器",
  /** ActivityBar 图谱：指向合同操作台内视口，不再独立系统 Tab 主路径 */
  graph: "任务图谱",
  settings: "设置",
} as const;

export type WorkbenchLabelKey = keyof typeof WORKBENCH_LABEL;
