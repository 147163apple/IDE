import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 面板拖拽调宽（Cursor / VS Code 式）。
 *
 * 为什么不用第三方 split-pane：只需要两个固定侧栏的拖宽，自己实现 50 行足够，
 * 也避免为一次 UI 迭代引入新依赖（依赖面越大，回归面越大）。
 *
 * 语义约定：
 * - `side="left"`：面板在左，向右拖 = 变宽；
 * - `side="right"`：面板在右，向左拖 = 变宽；
 * - 拖拽过程夹在 [min, max]，不会把中栏挤成 0；
 * - 宽度不落 localStorage：本轮先做可验证的交互，持久化留待确认后再加。
 */
export interface UseResizablePanelOptions {
  initial: number;
  min?: number;
  max?: number;
  side: "left" | "right";
}

export function useResizablePanel({
  initial,
  min = 180,
  max = 560,
  side,
}: UseResizablePanelOptions) {
  const [width, setWidth] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; w: number } | null>(null);

  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, value)),
    [min, max],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      start.current = { x: event.clientX, w: width };
      setDragging(true);
      // 防止拖拽时选中文本
      event.preventDefault();
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const anchor = start.current;
      if (!anchor) return;
      const dx = event.clientX - anchor.x;
      setWidth(clamp(anchor.w + (side === "left" ? dx : -dx)));
    };
    const up = () => {
      start.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, side, clamp]);

  return {
    width,
    dragging,
    /** 绑到分隔条上 */
    resizerProps: {
      onPointerDown,
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-valuenow": width,
      "aria-valuemin": min,
      "aria-valuemax": max,
    },
  };
}
