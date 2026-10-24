/** C.10i：右键与顶栏操作文案（浏览器侧可安全引用） */

export function revealMenuLabel(
  platform: string = typeof navigator !== "undefined" ? navigator.platform : "",
): string {
  return /Mac/i.test(platform) ? "在 Finder 中显示" : "在文件管理器中显示";
}

export function copyPathMenuLabel(): string {
  return "复制路径";
}

export function renameMenuLabel(): string {
  return "重命名…";
}

/** 绝对路径：root + rel（rel 为 "." 时只返回 root） */
export function absoluteRepoPath(rootLabel: string, relPath: string): string {
  const root = rootLabel.replace(/\/+$/, "");
  const rel = (relPath || "").replace(/^\/+/, "");
  if (!rel || rel === ".") return root;
  return `${root}/${rel}`;
}

/** 同目录重命名：fromRel + 新叶子名 → toRel */
export function siblingRenamePath(fromRel: string, newName: string): string {
  const trimmed = fromRel.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  parts[parts.length - 1] = newName.trim();
  return parts.join("/");
}

/** 在父目录下拼新建路径的父相对路径：选中文件→其父；选中文件夹→其本身；无选中→根 */
export function createParentRel(args: {
  selectedPath: string | null;
  selectedKind: "file" | "dir" | null;
}): string {
  if (!args.selectedPath || !args.selectedKind) return "";
  if (args.selectedKind === "dir") return args.selectedPath;
  const parts = args.selectedPath.split("/");
  parts.pop();
  return parts.join("/");
}
