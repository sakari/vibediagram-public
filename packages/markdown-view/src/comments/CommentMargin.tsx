/**
 * Right-margin overlay that lays out one `ThreadBubble` per anchor in the
 * preview. It re-measures on container resize and on each markers update so
 * the bubbles stay aligned with their anchors.
 */

import { useEffect, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { ThreadBubble } from "./ThreadBubble";
import type { ThreadMarker } from "./types";

/** @public */
export type CommentMarginProps = {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly markers: readonly ThreadMarker[];
  readonly editorView?: EditorView;
  readonly currentAuthor: string;
  readonly activeThreadId: string | null;
  readonly onToggle: (id: string) => void;
};

type Position = { id: string; top: number };

const measure = (
  container: HTMLElement,
  markers: readonly ThreadMarker[],
): Position[] => {
  const containerRect = container.getBoundingClientRect();
  const positions: Position[] = [];
  for (const m of markers) {
    const r = m.anchorEl.getBoundingClientRect();
    positions.push({ id: m.id, top: r.top - containerRect.top });
  }
  // Stack overlapping bubbles by enforcing a minimum gap.
  const MIN_GAP = 28;
  const sorted = [...positions].sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.top - prev.top < MIN_GAP) {
      cur.top = prev.top + MIN_GAP;
    }
  }
  return sorted;
};

export function CommentMargin({
  containerRef,
  markers,
  editorView,
  currentAuthor,
  activeThreadId,
  onToggle,
}: CommentMarginProps) {
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      setPositions([]);
      return;
    }
    const update = (): void => {
      setPositions(measure(container, markers));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
    };
  }, [containerRef, markers]);

  const byId = new Map(markers.map((m) => [m.id, m] as const));

  return (
    <div className="vd-comment-margin" aria-label="Comment margin">
      {positions.map((p) => {
        const marker = byId.get(p.id);
        if (marker === undefined) return null;
        return (
          <ThreadBubble
            key={marker.id}
            marker={marker}
            editorView={editorView}
            currentAuthor={currentAuthor}
            expanded={activeThreadId === marker.id}
            onToggle={() => {
              onToggle(marker.id);
            }}
            top={p.top}
          />
        );
      })}
    </div>
  );
}
