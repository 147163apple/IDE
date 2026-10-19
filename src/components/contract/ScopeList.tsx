import type { SoftwareContract } from "@/lib/contract.schema";

export interface ScopeListProps {
  scope: SoftwareContract["authorization"]["file_system_scope"];
}

/** C.1 Scope 三分区：可写 / 只读 / 严禁（严禁显著锁定标识） */
export function ScopeList({ scope }: ScopeListProps) {
  const groups = [
    {
      key: "writable",
      title: "可写",
      hint: "Worker 仅可在此范围内修改",
      items: scope.writable_paths,
      className: "text-emerald-600",
    },
    {
      key: "readonly",
      title: "只读",
      hint: "可读取作为参考，禁止写入",
      items: scope.readonly_paths,
      className: "text-sky-600",
    },
    {
      key: "forbidden",
      title: "严禁（锁定）",
      hint: "任何读写一律硬拦截",
      items: scope.strictly_forbidden_paths,
      className: "text-destructive",
    },
  ] as const;

  return (
    <div className="space-y-2" data-testid="scope-list">
      {groups.map((group) => (
        <section
          key={group.key}
          className="rounded border border-border/60 p-2"
        >
          <header className="flex items-center gap-2">
            <h4 className={`text-[11px] font-semibold ${group.className}`}>
              {group.key === "forbidden" ? "🔒 " : ""}
              {group.title}（{group.items.length}）
            </h4>
            <span className="text-[10px] text-muted-foreground">
              {group.hint}
            </span>
          </header>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
            {group.items.length === 0 ? (
              <li className="text-muted-foreground">—</li>
            ) : (
              group.items.map((item) => (
                <li key={item} className="truncate">
                  {item}
                </li>
              ))
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
