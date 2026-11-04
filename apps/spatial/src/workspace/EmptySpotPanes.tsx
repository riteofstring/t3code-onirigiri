import { useEffect, useRef, useState } from "react";

const DRAG_TOLERANCE_PX = 4;
const SPOT_GAP_PX = 8;
const IGNORED = 'button, a, input, textarea, select, [role="menu"], [role="dialog"], [data-onirigiri-slot="pane"]';

interface Spot {
  readonly anchorPaneId: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function findSpot(stage: HTMLElement, x: number, y: number): Spot | null {
  const world = stage.querySelector<HTMLElement>('[data-onirigiri-slot="stage"]');
  if (!world) return null;
  const bounds = world.getBoundingClientRect();
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  let anchor: { id: string; box: DOMRect } | null = null;
  let next: DOMRect | null = null;
  for (const pane of stage.querySelectorAll<HTMLElement>('[data-onirigiri-slot="pane"]')) {
    const box = pane.getBoundingClientRect();
    if (y < box.top || y > box.bottom) continue;
    if (x >= box.left && x <= box.right) return null;
    if (box.right < x && (!anchor || box.right > anchor.box.right))
      anchor = { id: pane.dataset.onirigiriPaneId ?? "", box };
    if (box.left > x && (!next || box.left < next.left)) next = box;
  }
  if (!anchor?.id || anchor.id.startsWith("draft:")) return null;
  if (next && next.left - anchor.box.right < anchor.box.width / 2) return null;
  const origin = stage.getBoundingClientRect();
  const left = anchor.box.right + SPOT_GAP_PX;
  const room = next ? next.left - SPOT_GAP_PX - left : anchor.box.width;
  return {
    anchorPaneId: anchor.id,
    left: left - origin.left,
    top: anchor.box.top - origin.top,
    width: Math.min(room, anchor.box.width),
    height: anchor.box.height,
  };
}

export function useEmptySpotPanes(
  stage: HTMLElement | null,
  enabled: boolean,
  onAdd: (anchorPaneId: string) => void,
): Spot | null {
  const [spot, setSpot] = useState<Spot | null>(null);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  useEffect(() => {
    if (!stage || !enabled) {
      setSpot(null);
      return;
    }
    let frame: number | null = null;
    let down: { x: number; y: number } | null = null;
    const empty = (event: PointerEvent | MouseEvent) =>
      event.target instanceof Element && !event.target.closest(IGNORED);
    const move = (event: PointerEvent) => {
      if (frame !== null) cancelAnimationFrame(frame);
      const { clientX, clientY, buttons } = event;
      const target = empty(event);
      frame = requestAnimationFrame(() => {
        frame = null;
        setSpot(buttons === 0 && target ? findSpot(stage, clientX, clientY) : null);
      });
    };
    const leave = () => setSpot(null);
    const press = (event: PointerEvent) => {
      down = event.button === 0 && empty(event) ? { x: event.clientX, y: event.clientY } : null;
    };
    const click = (event: MouseEvent) => {
      const start = down;
      down = null;
      if (
        !start ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_TOLERANCE_PX ||
        !empty(event)
      )
        return;
      const found = findSpot(stage, event.clientX, event.clientY);
      if (!found) return;
      setSpot(null);
      onAddRef.current(found.anchorPaneId);
    };
    stage.addEventListener("pointermove", move, { passive: true });
    stage.addEventListener("pointerleave", leave);
    stage.addEventListener("pointerdown", press, { capture: true });
    stage.addEventListener("click", click);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", leave);
      stage.removeEventListener("pointerdown", press, { capture: true });
      stage.removeEventListener("click", click);
    };
  }, [enabled, stage]);
  return enabled ? spot : null;
}

export function EmptySpotOutline({ spot }: { spot: Spot | null }) {
  if (!spot) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-20 flex items-center justify-center rounded-lg border border-dashed border-foreground/15 text-foreground/30"
      style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }}
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </svg>
    </div>
  );
}
