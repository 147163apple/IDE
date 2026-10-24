/**
 * TASK-C.9c：打开项目面板生命周期（呈现层）。
 *
 * - 默认收起（与 C.9a openProjectDefaultExpanded=false 一致）
 * - 打开/切换/重开成功后由 UI 关闭面板
 * - 已连接会话：入口降级为「切换项目」，不作冷开首屏指挥官
 *
 * 不含系统文件夹选择器（D.1e）；不推翻 D.1 鉴权。
 */

export type OpenProjectEntryMode = "open" | "switch";

export interface OpenProjectEntryPresentation {
  mode: OpenProjectEntryMode;
  /** 按钮可见文案 */
  label: string;
  /** 默认是否展开；纪律上恒为 false */
  defaultExpanded: false;
}

/**
 * 已鉴权连接 → 切换；否则仍是「打开项目」（次要备用，主路径在右栏）。
 */
export function resolveOpenProjectEntryPresentation(input: {
  hasSession: boolean;
}): OpenProjectEntryPresentation {
  if (input.hasSession) {
    return {
      mode: "switch",
      label: "切换项目",
      defaultExpanded: false,
    };
  }
  return {
    mode: "open",
    label: "打开项目",
    defaultExpanded: false,
  };
}
