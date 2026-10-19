export interface FilterToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  showCycles: boolean;
  onToggleCycles: (next: boolean) => void;
  nodeCount: number;
  edgeCount: number;
  selectedCount: number;
  matches: number;
}

/** C.2 过滤器：搜索、环路开关、统计 */
export function FilterToolbar({
  query,
  onQueryChange,
  showCycles,
  onToggleCycles,
  nodeCount,
  edgeCount,
  selectedCount,
  matches,
}: FilterToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-2 py-1.5 text-[11px]">
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="按文件名搜索…"
        aria-label="搜索文件"
        className="w-48 rounded border border-border bg-background px-2 py-1 outline-none"
      />
      <span className="text-muted-foreground">
        {query ? `${matches} 个匹配` : `${nodeCount} 节点 / ${edgeCount} 边`}
      </span>
      <label className="ml-auto flex items-center gap-1">
        <input
          type="checkbox"
          checked={showCycles}
          onChange={(event) => onToggleCycles(event.target.checked)}
        />
        环路高亮
      </label>
      <span className="text-emerald-600">已选 {selectedCount}</span>
    </div>
  );
}
