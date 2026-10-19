export interface ScopeSelectorProps {
  selected: string[];
  onApply: (paths: string[]) => void;
  onClear: () => void;
  disabled?: boolean;
}

/** C.2 圈选结果导出为合同 writable_paths */
export function ScopeSelector({
  selected,
  onApply,
  onClear,
  disabled = false,
}: ScopeSelectorProps) {
  return (
    <div className="flex items-center gap-2 border-t border-border bg-card px-2 py-1.5 text-[11px]">
      <span className="text-muted-foreground">
        圈选 {selected.length} 个文件设为可写范围
      </span>
      <button
        type="button"
        disabled={disabled || selected.length === 0}
        onClick={() => onApply(selected)}
        className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40"
      >
        设为可写范围
      </button>
      <button
        type="button"
        disabled={selected.length === 0}
        onClick={onClear}
        className="rounded border border-border px-2 py-1 disabled:opacity-40"
      >
        清空
      </button>
      {selected.length > 0 && (
        <code className="ml-auto max-w-[40%] truncate text-[10px] text-muted-foreground">
          {selected.slice(0, 3).join(", ")}
          {selected.length > 3 ? " …" : ""}
        </code>
      )}
    </div>
  );
}
