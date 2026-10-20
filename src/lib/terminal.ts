/**
 * TASK-C.5 终端回放的纯函数（便于独立测试）：
 * - 头尾各保留 200 行，中间折叠；
 * - 极简 ANSI SGR 解析（颜色/加粗/暗色），其余控制序列丢弃；
 * - 行内容脱敏由 Daemon 侧完成，这里只负责显示，绝不先截断。
 */

export interface TerminalLine {
  stream: "stdout" | "stderr";
  line: string;
  at?: string;
}

export const TERMINAL_KEEP_LINES = 200;

export interface TruncatedTerminal {
  head: TerminalLine[];
  tail: TerminalLine[];
  omitted: number;
}

/** 头尾各保留 keep 行，中间折叠 */
export function truncateHeadTail(
  lines: TerminalLine[],
  keep: number = TERMINAL_KEEP_LINES,
): TruncatedTerminal {
  if (lines.length <= keep * 2) {
    return { head: lines, tail: [], omitted: 0 };
  }
  return {
    head: lines.slice(0, keep),
    tail: lines.slice(lines.length - keep),
    omitted: lines.length - keep * 2,
  };
}

export interface AnsiSegment {
  text: string;
  className: string;
}

const FG: Record<number, string> = {
  30: "text-neutral-500",
  31: "text-red-500",
  32: "text-emerald-500",
  33: "text-amber-500",
  34: "text-blue-500",
  35: "text-fuchsia-500",
  36: "text-cyan-500",
  37: "text-foreground",
  90: "text-neutral-500",
  91: "text-red-400",
  92: "text-emerald-400",
  93: "text-amber-400",
  94: "text-blue-400",
  95: "text-fuchsia-400",
  96: "text-cyan-400",
  97: "text-foreground",
};

/** SGR：\x1b[...m（转义符动态构造，避免正则字面量里的控制字符告警） */
const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");
const OTHER_CSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");

/** 极简 ANSI 解析：颜色/加粗/暗色；背景色与其他属性不展开，避免误伤可读性 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let last = 0;
  let bold = false;
  let dim = false;
  let color = "";
  const push = (text: string) => {
    if (!text) return;
    const classes = [color, bold ? "font-bold" : "", dim ? "opacity-70" : ""]
      .filter(Boolean)
      .join(" ");
    segments.push({ text, className: classes });
  };
  let match: RegExpExecArray | null;
  while ((match = SGR.exec(input)) !== null) {
    push(input.slice(last, match.index));
    const codes = (match[1] ?? "").split(";").filter(Boolean).map(Number);
    if (codes.length === 0) codes.push(0);
    for (const code of codes) {
      if (code === 0) {
        bold = false;
        dim = false;
        color = "";
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        bold = false;
        dim = false;
      } else if (FG[code]) color = FG[code];
      else if (code === 39) color = "";
    }
    last = match.index + match[0].length;
  }
  push(input.slice(last));
  return segments
    .map((s) => ({ ...s, text: s.text.replace(OTHER_CSI, "") }))
    .filter((s) => s.text.length > 0);
}
