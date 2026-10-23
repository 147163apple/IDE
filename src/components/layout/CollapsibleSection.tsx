import type { ReactNode } from "react";

/**
 * 布局重构（UI 体验）：可折叠面板骨架。
 *
 * 为什么单独抽一个组件：重构后同时存在「文件树 / Studio 审阅 / SmartTerminal」
 * 三处需要收拢的面板。此前每处各写一套开关按钮，文案、无障碍属性与折叠语义
 * 都不一致，用户看不出“哪个能收、收起后会丢什么”。这里统一成：
 * - 标题栏即开关（整条可点，不用瞄准小图标）；
 * - `aria-expanded` + `data-state` 双写，键盘与自动化都能判读；
 * - 折叠后仍渲染 `summary`，让“收起了什么”始终可见。
 */
export interface CollapsibleSectionProps {
  /** 供测试与选择器定位的稳定标识 */
  testId: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  /** 折叠态仍展示的一句话摘要（避免收起后完全失去上下文） */
  summary?: ReactNode;
  /** 展开/收起按钮上的文案（默认按状态生成） */
  toggleLabel?: { open: string; closed: string };
  className?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  testId,
  title,
  open,
  onToggle,
  summary,
  toggleLabel,
  className = "",
  children,
}: CollapsibleSectionProps) {
  const label = open
    ? (toggleLabel?.open ?? `收起${title}`)
    : (toggleLabel?.closed ?? `展开${title}`);

  return (
    <section
      data-testid={testId}
      data-state={open ? "open" : "closed"}
      className={`flex min-h-0 flex-col ${className}`}
    >
      <header className="flex items-center gap-2 border-b px-2 py-1 text-xs">
        <span className="font-semibold">{title}</span>
        {!open && summary ? (
          <span
            data-testid={`${testId}-summary`}
            className="truncate opacity-60"
          >
            {summary}
          </span>
        ) : null}
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          aria-expanded={open}
          onClick={onToggle}
          className="ml-auto rounded border px-2 py-0.5 hover:bg-muted"
        >
          {label}
        </button>
      </header>
      {open ? (
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      ) : null}
    </section>
  );
}
