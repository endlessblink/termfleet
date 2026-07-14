import { useLayoutEffect, useRef } from "react";

export function useFlipList<T extends HTMLElement>(dependencyKey: string) {
  const containerRef = useRef<T | null>(null);
  const rectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const nextRects = new Map<string, DOMRect>();
    const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-flip-key]"));

    for (const element of elements) {
      const key = element.getAttribute("data-flip-key");
      if (!key) continue;

      const nextRect = element.getBoundingClientRect();
      const previousRect = rectsRef.current.get(key);
      nextRects.set(key, nextRect);

      if (!previousRect) continue;
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;

      element.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
    }

    rectsRef.current = nextRects;
  }, [dependencyKey]);

  return containerRef;
}
