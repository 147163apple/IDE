import { useMemo } from "react";
import {
  parseAnsi,
  truncateHeadTail,
  TERMINAL_KEEP_LINES,
  type TerminalLine,
} from "@/lib/terminal";

/**
 * TASK-C.5 结构化终端回放：
 * - 行内容由 Daemon 侧先脱敏再推送（前端绝不做「先截断后脱敏」）；
 * - ANSI SGR 颜色解析；
 * - 超长输出头尾各留 200 行，中间折叠并标注省略行数（前端不崩溃）。
 */

export interface StructuredTerminalProps {
  lines: TerminalLine[];
  /** 标题右侧的附注（例如命令别名） */
  hint?: string;
}

export function StructuredTerminal({ lines, hint }: StructuredTerminalProps) {
  const view = useMemo(() => truncateHeadTail(lines), [lines]);
  if (lines.length === 0) {
    return (
      <div
        data-testid="terminal-empty"
        className="rounded border border-border bg-card p-3 text-center text-xs text-muted-foreground"
      >
        本轮还没有命令输出
      </div>
    );
  }
  const renderLine = (line: TerminalLine, index: number) => (
    <div
      key={`${index}-${line.stream}`}
      data-stream={line.stream}
      className={`whitespace-pre-wrap break-all ${
        line.stream === "stderr" ? "text-red-400" : ""
      }`}
    >
      {parseAnsi(line.line).map((seg, i) => (
        <span key={i} className={seg.className}>
          {seg.text}
        </span>
      ))}
    </div>
  );
  return (
    <section
      data-testid="structured-terminal"
      className="overflow-hidden rounded border border-border bg-black/80 text-[11px] leading-5 text-neutral-200"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-2 py-1 text-[10px] text-neutral-400">
        <span>终端输出</span>
        <span>{hint ?? `${lines.length} 行`}</span>
      </header>
      <div className="max-h-64 overflow-auto p-2 font-mono">
        {view.head.map(renderLine)}
        {view.omitted > 0 && (
          <div
            data-testid="terminal-omitted"
            className="my-1 border-y border-white/10 py-0.5 text-center text-amber-400"
          >
            … 中间省略 {view.omitted} 行（头尾各保留 {TERMINAL_KEEP_LINES} 行）…
          </div>
        )}
        {view.tail.map((line, index) =>
          renderLine(line, view.head.length + index),
        )}
      </div>
    </section>
  );
}
