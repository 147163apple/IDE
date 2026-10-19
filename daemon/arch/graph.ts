import fs from "node:fs";
import path from "node:path";
import {
  loadPathAliases,
  parseFile,
  parseSource,
  type ParsedModule,
  type PathAliasConfig,
} from "./parser";

/**
 * 内存文件级依赖图（规范 TASK-B.1）。
 * - Tarjan 强连通分量检测循环依赖
 * - Kahn 拓扑排序（存在环时返回已排序部分 + hasCycle）
 * - 单文件增量更新（只重解析一个文件并重建其出边）
 */
export interface GraphNode {
  filePath: string;
  exports: string[];
  imports: Array<{
    specifier: string;
    resolved: string | null;
    typeOnly: boolean;
  }>;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  cycles: number;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".stagent",
  "dist",
  ".output",
  "coverage",
]);

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export class DependencyGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, Set<string>>();
  private readonly reverse = new Map<string, Set<string>>();

  addModule(parsed: ParsedModule): void {
    const filePath = path.resolve(parsed.filePath);
    this.removeModule(filePath);

    this.nodes.set(filePath, {
      filePath,
      exports: parsed.exports,
      imports: parsed.imports.map((i) => ({
        specifier: i.specifier,
        resolved: i.resolved ? path.resolve(i.resolved) : null,
        typeOnly: i.typeOnly,
      })),
    });

    const out = new Set<string>();
    for (const imp of parsed.imports) {
      if (!imp.resolved) continue;
      const target = path.resolve(imp.resolved);
      out.add(target);
      if (!this.reverse.has(target)) this.reverse.set(target, new Set());
      this.reverse.get(target)?.add(filePath);
    }
    this.edges.set(filePath, out);
  }

  removeModule(filePath: string): void {
    const key = path.resolve(filePath);
    const out = this.edges.get(key);
    if (out) {
      for (const target of out) this.reverse.get(target)?.delete(key);
    }
    this.edges.delete(key);
    this.nodes.delete(key);
    this.reverse.delete(key);
  }

  has(filePath: string): boolean {
    return this.nodes.has(path.resolve(filePath));
  }

  getNode(filePath: string): GraphNode | undefined {
    return this.nodes.get(path.resolve(filePath));
  }

  getDependencies(filePath: string): string[] {
    return [...(this.edges.get(path.resolve(filePath)) ?? [])];
  }

  getDependents(filePath: string): string[] {
    return [...(this.reverse.get(path.resolve(filePath)) ?? [])];
  }

  getStats(): GraphStats {
    let edges = 0;
    for (const out of this.edges.values()) edges += out.size;
    return {
      nodes: this.nodes.size,
      edges,
      cycles: this.detectCycles().length,
    };
  }

  /** Tarjan 强连通分量（迭代实现，避免深链递归溢出） */
  detectCycles(): string[][] {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const result: string[][] = [];
    let counter = 0;

    for (const start of this.nodes.keys()) {
      if (index.has(start)) continue;

      const work: Array<{
        node: string;
        childIndex: number;
        children: string[];
      }> = [
        {
          node: start,
          childIndex: 0,
          children: [...(this.edges.get(start) ?? [])].filter((c) =>
            this.nodes.has(c),
          ),
        },
      ];
      index.set(start, counter);
      low.set(start, counter);
      counter += 1;
      stack.push(start);
      onStack.add(start);

      while (work.length > 0) {
        const frame = work[work.length - 1];
        if (!frame) break;

        if (frame.childIndex < frame.children.length) {
          const child = frame.children[frame.childIndex] as string;
          frame.childIndex += 1;

          if (!index.has(child)) {
            index.set(child, counter);
            low.set(child, counter);
            counter += 1;
            stack.push(child);
            onStack.add(child);
            work.push({
              node: child,
              childIndex: 0,
              children: [...(this.edges.get(child) ?? [])].filter((c) =>
                this.nodes.has(c),
              ),
            });
          } else if (onStack.has(child)) {
            low.set(
              frame.node,
              Math.min(
                low.get(frame.node) as number,
                index.get(child) as number,
              ),
            );
          }
          continue;
        }

        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          low.set(
            parent.node,
            Math.min(
              low.get(parent.node) as number,
              low.get(frame.node) as number,
            ),
          );
        }

        if (low.get(frame.node) === index.get(frame.node)) {
          const component: string[] = [];
          for (;;) {
            const popped = stack.pop();
            if (popped === undefined) break;
            onStack.delete(popped);
            component.push(popped);
            if (popped === frame.node) break;
          }
          const isSelfLoop =
            component.length === 1 &&
            (this.edges
              .get(component[0] as string)
              ?.has(component[0] as string) ??
              false);
          if (component.length > 1 || isSelfLoop)
            result.push(component.reverse());
        }
      }
    }

    return result;
  }

  /** Kahn 拓扑排序（依赖优先：被依赖模块排在前面）；有环时返回可排序部分 */
  topologicalSort(): { order: string[]; hasCycle: boolean } {
    const indegree = new Map<string, number>();
    for (const node of this.nodes.keys()) {
      // 入度 = 该模块依赖的、且存在于图中的模块数量
      const deps = [...(this.edges.get(node) ?? [])].filter((d) =>
        this.nodes.has(d),
      );
      indegree.set(node, deps.length);
    }

    const queue = [...indegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([node]) => node)
      .sort();
    const order: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift() as string;
      order.push(node);
      // 依赖 node 的模块，入度减一
      for (const dependent of this.reverse.get(node) ?? []) {
        if (!this.nodes.has(dependent)) continue;
        const next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) queue.push(dependent);
      }
    }

    return { order, hasCycle: order.length !== this.nodes.size };
  }

  /** 增量更新：重解析单个文件并返回耗时（ms） */
  updateFile(
    filePath: string,
    content: string,
    aliases: PathAliasConfig,
  ): number {
    const start = performance.now();
    this.addModule(parseSource(filePath, content, aliases));
    return performance.now() - start;
  }

  toJSON(): { nodes: GraphNode[]; edges: Array<{ from: string; to: string }> } {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges].flatMap(([from, targets]) =>
        [...targets].map((to) => ({ from, to })),
      ),
    };
  }
}

function walkSourceFiles(root: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkSourceFiles(path.join(root, entry.name), acc);
    } else if (SOURCE_EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      acc.push(path.join(root, entry.name));
    }
  }
  return acc;
}

/** 冷启动全量构建（规范性能基线：1000 模块 ≤1.5s） */
export function buildDependencyGraph(options: {
  root: string;
  aliases?: PathAliasConfig;
  files?: string[];
}): { graph: DependencyGraph; durationMs: number } {
  const start = performance.now();
  const root = path.resolve(options.root);
  const aliases = options.aliases ?? loadPathAliases(root);
  const files = options.files ?? walkSourceFiles(root);
  const graph = new DependencyGraph();
  for (const file of files) {
    try {
      graph.addModule(parseFile(file, aliases));
    } catch {
      // 单文件解析失败不阻断全量构建
    }
  }
  return { graph, durationMs: performance.now() - start };
}
