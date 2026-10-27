import { useState } from "react";
import { TaskGraphPanel } from "@/components/graph/TaskGraphPanel";
import type { TaskGraph } from "@/lib/graph/task-graph";
import { PanoramaPane, type PanoramaSummary } from "./PanoramaPane";
import type { BaselineArchivePayload } from "@/lib/daemon-api";
import { StudioLensShell } from "./StudioLensShell";

/**
 * Studio 视口 2：全景 / 施工双视角（TASK-C.10q）+ 施工侧复用 C.7 TaskGraphPanel。
 *
 * - 全景：合同白话摘要 + v0.2 三卡占位（无施工绿灯）
 * - 施工：既有任务图谱（空态/开工/核销不变）
 */
export interface TaskGraphPaneProps {
  graph: TaskGraph | null;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRefresh?: (() => void) | undefined;
  onConfirmPrototype?: (() => void) | undefined;
  confirmPrototypeBusy?: boolean | undefined;
  onStartNode?: ((nodeId: string) => void) | undefined;
  onVerifyNode?: ((nodeId: string) => void) | undefined;
  actionBusy?: boolean | undefined;
  /** C.10q：全景极薄摘要 */
  panoramaSummary?: PanoramaSummary | null | undefined;
  /** C.14：项目现状基线档案 */
  baseline?: BaselineArchivePayload | null | undefined;
  baselineBusy?: boolean | undefined;
  onAcceptBaseline?: (() => void) | undefined;
  onRescanBaseline?: (() => void) | undefined;
  onRunWorker?: (() => void) | undefined;
  canRunWorker?: boolean | undefined;
  runWorkerBusy?: boolean | undefined;
  runWorkerLabel?: string | undefined;
  /** 合入后提示：施工快照可能仍失败，成品看真机试玩/仓库 */
  deliveryNote?: string | null | undefined;
}

export function TaskGraphPane(props: TaskGraphPaneProps) {
  const hasGraph = props.graph !== null;
  const [preferConstructionKey, setPreferConstructionKey] = useState(0);

  return (
    <div data-testid="task-graph-pane" className="flex h-full min-h-0 flex-col">
      <StudioLensShell
        hasGraph={hasGraph}
        {...(preferConstructionKey > 0
          ? {
              preferLens: "construction" as const,
              preferLensKey: preferConstructionKey,
            }
          : {})}
        panorama={
          <PanoramaPane
            summary={props.panoramaSummary ?? null}
            baseline={props.baseline ?? null}
            {...(props.baselineBusy === undefined
              ? {}
              : { baselineBusy: props.baselineBusy })}
            {...(props.onAcceptBaseline === undefined
              ? {}
              : { onAcceptBaseline: props.onAcceptBaseline })}
            {...(props.onRescanBaseline === undefined
              ? {}
              : { onRescanBaseline: props.onRescanBaseline })}
            hasGraph={hasGraph}
            onGoConstruction={() => setPreferConstructionKey((n) => n + 1)}
            {...(props.onConfirmPrototype === undefined
              ? {}
              : { onConfirmPrototype: props.onConfirmPrototype })}
            {...(props.confirmPrototypeBusy === undefined
              ? {}
              : { confirmPrototypeBusy: props.confirmPrototypeBusy })}
          />
        }
        construction={
          <>
            {props.deliveryNote?.trim() ? (
              <div
                data-testid="task-graph-delivery-note"
                className="border-b border-emerald-600/30 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-900"
              >
                {props.deliveryNote.trim()}
              </div>
            ) : null}
            <TaskGraphPanel
              graph={props.graph}
              {...(props.loading === undefined
                ? {}
                : { loading: props.loading })}
              {...(props.error === undefined ? {} : { error: props.error })}
              {...(props.onRefresh === undefined
                ? {}
                : { onRefresh: props.onRefresh })}
              {...(props.onConfirmPrototype === undefined
                ? {}
                : { onConfirmPrototype: props.onConfirmPrototype })}
              {...(props.confirmPrototypeBusy === undefined
                ? {}
                : { confirmPrototypeBusy: props.confirmPrototypeBusy })}
              {...(props.onStartNode === undefined
                ? {}
                : { onStartNode: props.onStartNode })}
              {...(props.onVerifyNode === undefined
                ? {}
                : { onVerifyNode: props.onVerifyNode })}
              {...(props.actionBusy === undefined
                ? {}
                : { actionBusy: props.actionBusy })}
              {...(props.onRunWorker === undefined
                ? {}
                : { onRunWorker: props.onRunWorker })}
              {...(props.canRunWorker === undefined
                ? {}
                : { canRunWorker: props.canRunWorker })}
              {...(props.runWorkerBusy === undefined
                ? {}
                : { runWorkerBusy: props.runWorkerBusy })}
              {...(props.runWorkerLabel === undefined
                ? {}
                : { runWorkerLabel: props.runWorkerLabel })}
            />
          </>
        }
      />
    </div>
  );
}
