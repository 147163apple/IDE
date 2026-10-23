import {
  FileCheck2,
  FileText,
  LayoutTemplate,
  ShieldCheck,
} from "lucide-react";
import { CollapsibleSection } from "./layout/CollapsibleSection";

/**
 * 左侧文件树的【规范与资产】专区（TASK-C.7）。
 *
 * 为什么单独做一块而不是混进文件树：需求、合同、Demo 原型是"本轮任务的
 * 依据"，和源码文件不是同一类东西。混排会让用户以为 `.stagent/contracts/*.json`
 * 也是可以直接改的源码。
 *
 * 数据全部由主页面注入（选中合同 + 真实文件存在性 + Task Graph 进度），
 * 本组件不臆造路径：没有 Demo 就显示"未生成"，不画一个点不开的假条目。
 */
export type SpecAssetKind = "requirement" | "contract" | "demo";
export type SpecAssetStatus = "READY" | "GENERATING" | "MISSING";

export interface SpecAsset {
  id: string;
  kind: SpecAssetKind;
  label: string;
  status: SpecAssetStatus;
  /** 可打开的相对路径；缺省表示这不是一个文件（例如需求标题） */
  path?: string;
  hint?: string;
  /** GENERATING 时的 0–100 进度 */
  progress?: number;
}

export interface SpecGenerationProgress {
  percent: number;
  illuminated: number;
  total: number;
  updatedAt?: string;
}

export interface FileTreeSpecsSectionProps {
  assets: SpecAsset[];
  open: boolean;
  onToggle: () => void;
  onOpen?: ((path: string) => void) | undefined;
  generation?: SpecGenerationProgress | null | undefined;
}

const KIND_META: Record<
  SpecAssetKind,
  { title: string; icon: typeof FileText }
> = {
  requirement: { title: "需求文档", icon: FileText },
  contract: { title: "合同", icon: ShieldCheck },
  demo: { title: "Demo 原型", icon: LayoutTemplate },
};

const STATUS_META: Record<
  SpecAssetStatus,
  { label: string; className: string }
> = {
  READY: { label: "就绪", className: "bg-emerald-100 text-emerald-800" },
  GENERATING: { label: "生成中", className: "bg-amber-100 text-amber-800" },
  MISSING: { label: "未生成", className: "bg-stone-200 text-stone-600" },
};

export function FileTreeSpecsSection({
  assets,
  open,
  onToggle,
  onOpen,
  generation,
}: FileTreeSpecsSectionProps) {
  const ready = assets.filter((asset) => asset.status === "READY").length;

  return (
    <CollapsibleSection
      testId="file-tree-specs"
      title="规范与资产"
      open={open}
      onToggle={onToggle}
      summary={
        assets.length === 0 ? "未绑定需求" : `${ready}/${assets.length} 就绪`
      }
      toggleLabel={{ open: "收起资产", closed: "展开资产" }}
      className="shrink-0 border-b"
    >
      <div className="space-y-2 px-2 py-2 text-xs">
        {generation ? (
          <div
            data-testid="specs-generation-progress"
            role="progressbar"
            aria-label="本轮生成进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={generation.percent}
            className="space-y-1"
          >
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                本轮生成进度 {generation.percent}%（点亮{" "}
                {generation.illuminated}/{generation.total} 节点）
              </span>
              {generation.updatedAt ? (
                <span className="tabular-nums">{generation.updatedAt}</span>
              ) : null}
            </div>
            <span className="block h-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-emerald-500 transition-[width] duration-100"
                style={{ width: `${generation.percent}%` }}
              />
            </span>
          </div>
        ) : null}

        {assets.length === 0 ? (
          <p className="leading-relaxed text-muted-foreground">
            选中一份合同后，这里列出本轮需求、合同文件与 Demo 原型。
          </p>
        ) : (
          (["requirement", "contract", "demo"] as const).map((kind) => {
            const group = assets.filter((asset) => asset.kind === kind);
            if (group.length === 0) return null;
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            return (
              <section key={kind} data-testid={`specs-group-${kind}`}>
                <h3 className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Icon className="h-3 w-3" aria-hidden />
                  {meta.title}
                </h3>
                <ul className="space-y-1">
                  {group.map((asset) => {
                    const status = STATUS_META[asset.status];
                    const body = (
                      <>
                        <span className="flex min-w-0 flex-1 items-center gap-1">
                          <FileCheck2
                            className="h-3 w-3 shrink-0 opacity-60"
                            aria-hidden
                          />
                          <span className="truncate">{asset.label}</span>
                        </span>
                        <span
                          className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </>
                    );
                    return (
                      <li key={asset.id}>
                        {asset.path ? (
                          <button
                            type="button"
                            data-testid={`spec-asset-${asset.id}`}
                            data-status={asset.status}
                            title={asset.path}
                            onClick={() => {
                              if (asset.path) onOpen?.(asset.path);
                            }}
                            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-accent/60"
                          >
                            {body}
                          </button>
                        ) : (
                          <div
                            data-testid={`spec-asset-${asset.id}`}
                            data-status={asset.status}
                            className="flex w-full items-center gap-2 px-1 py-1"
                          >
                            {body}
                          </div>
                        )}
                        {asset.hint ? (
                          <p className="pl-4 text-[10px] leading-snug text-muted-foreground">
                            {asset.hint}
                          </p>
                        ) : null}
                        {asset.status === "GENERATING" &&
                        typeof asset.progress === "number" ? (
                          <span
                            data-testid={`spec-progress-${asset.id}`}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={asset.progress}
                            className="ml-4 mt-0.5 block h-0.5 overflow-hidden rounded-full bg-muted"
                          >
                            <span
                              className="block h-full bg-amber-500 transition-[width] duration-100"
                              style={{ width: `${asset.progress}%` }}
                            />
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </CollapsibleSection>
  );
}
