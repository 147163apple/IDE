/** C.10h：右键删除菜单文案（浏览器侧可安全引用） */
export function deleteMenuLabel(
  platform: string = typeof navigator !== "undefined" ? navigator.platform : "",
): string {
  return /Mac/i.test(platform) ? "移到废纸篓…" : "删除…";
}
