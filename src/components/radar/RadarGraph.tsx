import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";

export interface RadarNode {
  filePath: string;
  exports: string[];
}

export interface RadarEdge {
  from: string;
  to: string;
}

export interface RadarGraphProps {
  nodes: RadarNode[];
  edges: RadarEdge[];
  cycles: string[][];
  selected: string[];
  onSelectionChange: (paths: string[]) => void;
  focusPath?: string | undefined;
  showCycles?: boolean;
  className?: string;
}

const cycleNodeIds = (cycles: string[][], showCycles: boolean): Set<string> => {
  if (!showCycles) return new Set();
  const ids = new Set<string>();
  for (const cycle of cycles) for (const id of cycle) ids.add(id);
  return ids;
};

/** C.2 架构雷达画布：Cytoscape 渲染、点选圈定 Scope、环路高亮 */
export function RadarGraph({
  nodes,
  edges,
  cycles,
  selected,
  onSelectionChange,
  focusPath,
  showCycles = false,
  className,
}: RadarGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const highlighted = cycleNodeIds(cycles, showCycles);
    const elements = [
      ...nodes.map((node) => ({
        data: {
          id: node.filePath,
          label: node.filePath.split("/").pop() ?? node.filePath,
          cycle: highlighted.has(node.filePath) ? 1 : 0,
        },
      })),
      ...edges
        .filter(
          (edge) =>
            nodes.some((n) => n.filePath === edge.from) &&
            nodes.some((n) => n.filePath === edge.to),
        )
        .map((edge) => ({
          data: {
            id: `${edge.from}->${edge.to}`,
            source: edge.from,
            target: edge.to,
          },
        })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-size": 8,
            color: "#94a3b8",
            "background-color": "#475569",
            width: 14,
            height: 14,
          },
        },
        {
          selector: "node[cycle = 1]",
          style: { "background-color": "#ef4444", color: "#fecaca" },
        },
        {
          selector: "node:selected",
          style: { "background-color": "#22c55e", color: "#dcfce7" },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#334155",
            "target-arrow-color": "#334155",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "arrow-scale": 0.6,
          },
        },
      ],
      layout:
        nodes.length > 600
          ? { name: "grid", animate: false, avoidOverlap: true }
          : { name: "cose", animate: false, randomize: true },
    });

    cy.on("select unselect", "node", () => {
      onSelectionChange(cy.$("node:selected").map((n) => n.id() as string));
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // 只在拓扑变化时重建；选中态通过下方同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, cycles, showCycles]);

  // 外部选中态同步
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    for (const path of selected) {
      cy.getElementById(path).select();
    }
  }, [selected]);

  // 搜索定位
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !focusPath) return;
    const node = cy.getElementById(focusPath);
    if (node.nonempty()) {
      cy.animate({ center: { eles: node }, zoom: 1.4 }, { duration: 200 });
    }
  }, [focusPath]);

  return (
    <div
      ref={containerRef}
      data-testid="radar-graph"
      className={className ?? "h-full w-full"}
      aria-label="架构依赖图"
    />
  );
}
