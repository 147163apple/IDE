/**
 * TASK-C.10c / C.16：工作台用户可见白话标签。
 * 内部 id（system:supervisor-studio 等）保持不变；只改对人说的话。
 *
 * C.16：日常 ActivityBar **单门**进「合同操作台」（列表+五视口）；
 * 「项目审阅/项目全景」不再占第二个 ActivityBar 图标，仅作操作台内次入口。
 */
export const WORKBENCH_LABEL = {
  /**
   * 原 Supervisor 系统 Tab。C.16 起不再作为 ActivityBar 日常双门；
   * 操作台左侧栏「项目全景」可打开此 Tab（架构/准入深页）。
   */
  supervisor: "项目全景",
  /** 单门主入口：需求列表 + 五视口干活（与顶栏「打开合同操作台」一致） */
  studio: "合同操作台",
  /** ActivityBar 单门按钮文案（与 studio 同指） */
  workbench: "合同操作台",
  /** 原 SmartTerminal 底栏抽屉 */
  terminal: "验证输出",
  /** ActivityBar 文件树 */
  explorer: "资源管理器",
  /** 合同操作台内视口名；不再单独占 ActivityBar 日常入口 */
  graph: "任务图谱",
  settings: "设置",
} as const;

export type WorkbenchLabelKey = keyof typeof WORKBENCH_LABEL;
