/**
 * TASK-C.14b：两段式渐进扫描（P0 骨架 → P1/P2 深度流式加深）。
 * 深度未完不阻塞右栏；状态写入 baseline store。
 */
import {
  runDeepStaticScan,
  runP0SkeletonScan,
  P0_TIMEOUT_MS,
} from "./sandbox-scanner";
import { inspectWorkspaceDirty } from "./dirty-check";
import {
  newBaselineScanId,
  writeBaselineArchive,
  readBaselineArchive,
} from "./store";
import {
  SCAN_PROGRESS_COPY,
  type BaselineArchive,
  type BaselineDeepPartial,
  type BaselineGraphNode,
} from "./types";

export interface ProgressiveScanCallbacks {
  onP0?: (archive: BaselineArchive) => void;
  onDeep?: (archive: BaselineArchive) => void;
  onDone?: (archive: BaselineArchive) => void;
}

export interface ProgressiveScanOptions {
  repoRoot: string;
  toolVersion?: string;
  p0TimeoutMs?: number;
  deepTimeoutMs?: number;
  callbacks?: ProgressiveScanCallbacks;
  /** 测试：跳过真实 dirty git */
  dirtyOverride?: BaselineArchive["dirty"];
}

function capabilityNodesFromP0(
  archive: BaselineArchive,
): BaselineGraphNode[] {
  const nodes: BaselineGraphNode[] = [];
  const routes = archive.p0?.route_clues ?? [];
  for (const route of routes.slice(0, 24)) {
    const id = `cap:${route}`;
    const refs = [{ path: route, note: "静态路由/模块线索" }];
    nodes.push({
      id,
      title: route.startsWith("/") ? `页面 ${route}` : route,
      kind: "capability",
      provenance: "inferred",
      source_refs: refs,
      provenance_plain: `来源线索：${refs.map((r) => r.path).join(" + ")}`,
      status_plain: "已识别模块结构，但未经自动化测试验证",
      verification_status: "inferred_unverified",
      confidence_label: "根据代码线索归纳",
    });
  }
  if (archive.p0?.package_name) {
    nodes.unshift({
      id: `pkg:${archive.p0.package_name}`,
      title: archive.p0.package_name,
      kind: "module",
      provenance: "config",
      source_refs: [{ path: "package.json" }],
      provenance_plain: "来源线索：代码文件 package.json",
      status_plain: "已识别模块结构，但未经自动化测试验证",
      verification_status: "static_only",
      confidence_label: "代码中直接发现",
    });
  }
  return nodes;
}

function structureNodesFromDeep(
  paths: string[],
): BaselineGraphNode[] {
  return paths.slice(0, 60).map((p) => ({
    id: `struct:${p}`,
    title: p,
    kind: "structure" as const,
    provenance: "static_code" as const,
    source_refs: [{ path: p }],
    provenance_plain: `来源线索：代码文件 ${p}`,
    status_plain: "已识别模块结构，但未经自动化测试验证",
    verification_status: "static_only" as const,
    confidence_label: "代码中直接发现" as const,
  }));
}

/**
 * 跑完整渐进扫：先 P0 落盘并回调，再深度加深。
 * 返回最终档案；P0 阶段即可供右栏解锁。
 */
export async function runProgressiveBaselineScan(
  options: ProgressiveScanOptions,
): Promise<BaselineArchive> {
  const toolVersion = options.toolVersion ?? "0.1.0-c14";
  const scan_id = newBaselineScanId();
  const scanned_at = new Date().toISOString();

  const dirty =
    options.dirtyOverride ??
    (await inspectWorkspaceDirty(options.repoRoot));

  let archive: BaselineArchive = {
    schema_version: "1.0.0",
    kind: "project_baseline_archive",
    scan_id,
    scanned_at,
    tool_version: toolVersion,
    review_status: "pending_review",
    accepted_at: null,
    grants_construction: false,
    phase: "p0",
    progress_copy: SCAN_PROGRESS_COPY.scanning,
    p0: null,
    deep: null,
    dirty,
    ignore_rules: [
      "node_modules/",
      ".git/",
      ".stagent/",
      "dist/",
      "build/",
      "coverage/",
    ],
    incomplete: false,
    notes: ["打开即自动扫；确认≠授权；观察≠质量结论"],
  };

  // —— P0 ——
  const p0 = runP0SkeletonScan({
    repoRoot: options.repoRoot,
    timeoutMs: options.p0TimeoutMs ?? P0_TIMEOUT_MS,
  });
  archive = {
    ...archive,
    phase: "p1",
    progress_copy: SCAN_PROGRESS_COPY.organizing,
    p0,
    incomplete: p0.timed_out,
  };
  writeBaselineArchive(options.repoRoot, archive);
  options.callbacks?.onP0?.(archive);

  // —— P1/P2 深度 ——
  archive = {
    ...archive,
    phase: "p2",
    progress_copy: SCAN_PROGRESS_COPY.deep,
  };
  writeBaselineArchive(options.repoRoot, archive);

  const deepRaw = runDeepStaticScan({
    repoRoot: options.repoRoot,
    timeoutMs: options.deepTimeoutMs ?? 12_000,
  });

  const deep: BaselineDeepPartial = {
    structure_nodes: structureNodesFromDeep(deepRaw.structure_paths),
    capability_nodes: capabilityNodesFromP0(archive),
    test_file_count: deepRaw.test_file_count,
    test_stat_note:
      `静态发现 ${deepRaw.test_file_count} 个测试文件声明（不代表测试通过或覆盖良好）`,
    import_edge_count: deepRaw.import_edge_count,
    duration_ms: deepRaw.duration_ms,
    timed_out: deepRaw.timed_out,
    incomplete: deepRaw.incomplete,
  };

  archive = {
    ...archive,
    phase: deep.incomplete ? "done" : "done",
    progress_copy: deep.incomplete
      ? SCAN_PROGRESS_COPY.failed
      : SCAN_PROGRESS_COPY.done,
    deep,
    incomplete: Boolean(p0.timed_out || deep.incomplete),
    review_status: deep.incomplete ? "incomplete" : "pending_review",
  };
  writeBaselineArchive(options.repoRoot, archive);
  options.callbacks?.onDeep?.(archive);
  options.callbacks?.onDone?.(archive);
  return archive;
}

/** 深度是否仍在进行（供防抢跑） */
export function isBaselineDeepIncomplete(
  archive: BaselineArchive | null,
): boolean {
  if (!archive) return true;
  if (archive.phase === "p0" || archive.phase === "p1" || archive.phase === "p2") {
    return true;
  }
  return Boolean(archive.deep?.incomplete) && archive.phase !== "done";
}

export function getLatestBaseline(repoRoot: string): BaselineArchive | null {
  return readBaselineArchive(repoRoot);
}
