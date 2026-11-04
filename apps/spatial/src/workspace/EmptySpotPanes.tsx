import type { OnirigiriLayout } from "@riteofstring/onirigiri";
import { useEffect, useRef, useState } from "react";

import type { PanePlacement } from "./workspaceLayout";

const DRAG_TOLERANCE_PX = 4;
const SPOT_GAP_PX = 8;
const IGNORED = 'button, a, input, textarea, select, [role="menu"], [role="dialog"], [data-onirigiri-slot="pane"]';

export interface EmptySpot {
  readonly ownerPaneId: string | null;
  readonly placement: PanePlacement;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface PaneBox {
  readonly id: string;
  readonly box: DOMRect;
  readonly plane: number;
  readonly slot: number;
}

const MIN_SPOT_PX = 48;

function findSpot(
  stage: HTMLElement,
  layout: OnirigiriLayout | null,
  allowNewRows: boolean,
  x: number,
  y: number,
): EmptySpot | null {
  const world = stage.querySelector<HTMLElement>('[data-onirigiri-slot="stage"]');
  if (!world || !layout) return null;
  const bounds = world.getBoundingClientRect();
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  const located = new Map(
    layout.columns.flatMap((column) =>
      column.cells.flatMap((cell) =>
        cell.paneId === null
          ? []
          : [[cell.paneId, { plane: column.planeIndex, slot: column.slotIndex ?? column.index }] as const],
      ),
    ),
  );
  const panes: PaneBox[] = [];
  for (const element of stage.querySelectorAll<HTMLElement>('[data-onirigiri-slot="pane"]')) {
    const id = element.dataset.onirigiriPaneId;
    const place = id ? located.get(id) : undefined;
    if (!id || !place) continue;
    const box = element.getBoundingClientRect();
    if (box.right < bounds.left || box.left > bounds.right) continue;
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return null;
    panes.push({ id, box, ...place });
  }
  if (panes.length === 0) return null;
  const origin = stage.getBoundingClientRect();
  const owner = (pane: PaneBox | undefined) =>
    pane && !pane.id.startsWith("draft:") ? pane.id : null;
  const spot = (
    ownerPaneId: string | null,
    placement: PanePlacement,
    left: number,
    top: number,
    width: number,
    height: number,
  ): EmptySpot | null =>
    width < MIN_SPOT_PX || height < MIN_SPOT_PX
      ? null
      : {
          ownerPaneId,
          placement,
          left: left - origin.left,
          top: top - origin.top,
          width,
          height,
        };

  const row = panes
    .filter((pane) => y >= pane.box.top && y <= pane.box.bottom)
    .toSorted((a, b) => a.box.left - b.box.left);
  if (row.length > 0) {
    const plane = row[0]!.plane;
    const before = row.filter((pane) => pane.box.right < x).at(-1);
    const after = row.find((pane) => pane.box.left > x);
    const reference = (before ?? after)!;
    const { top, height, width } = reference.box;
    if (before && after) {
      const room = after.box.left - before.box.right - 2 * SPOT_GAP_PX;
      return spot(
        owner(before) ?? owner(after),
        { plane, slot: before.slot + 1, newPlane: false },
        before.box.right + SPOT_GAP_PX,
        top,
        Math.min(room, width),
        height,
      );
    }
    if (before)
      return spot(
        owner(before),
        { plane, slot: before.slot + 1, newPlane: false },
        before.box.right + SPOT_GAP_PX,
        top,
        width,
        height,
      );
    return spot(
      owner(after),
      { plane, slot: after!.slot, newPlane: false },
      after!.box.left - SPOT_GAP_PX - width,
      top,
      width,
      height,
    );
  }

  if (!allowNewRows) return null;
  const above = panes.filter((pane) => pane.box.bottom < y);
  const below = panes.filter((pane) => pane.box.top > y);
  const aboveBottom = above.length ? Math.max(...above.map((pane) => pane.box.bottom)) : null;
  const belowTop = below.length ? Math.min(...below.map((pane) => pane.box.top)) : null;
  const nearest = (belowTop !== null && (aboveBottom === null || belowTop - y < y - aboveBottom)
    ? below.filter((pane) => pane.box.top === belowTop)
    : above.filter((pane) => pane.box.bottom === aboveBottom)
  ).toSorted((a, b) => Math.abs((a.box.left + a.box.right) / 2 - x) - Math.abs((b.box.left + b.box.right) / 2 - x));
  const column = nearest[0];
  if (!column) return null;
  const height = column.box.height;
  const plane =
    belowTop !== null
      ? below.find((pane) => pane.box.top === belowTop)!.plane
      : above.find((pane) => pane.box.bottom === aboveBottom)!.plane + 1;
  const top =
    aboveBottom !== null
      ? aboveBottom + SPOT_GAP_PX
      : belowTop! - SPOT_GAP_PX - height;
  const room = belowTop !== null && aboveBottom !== null ? belowTop - SPOT_GAP_PX - top : height;
  return spot(
    null,
    { plane, slot: column.slot, newPlane: true },
    column.box.left,
    top,
    column.box.width,
    Math.min(room, height),
  );
}

export function useEmptySpotPanes(
  stage: HTMLElement | null,
  enabled: boolean,
  allowNewRows: boolean,
  getLayout: () => OnirigiriLayout | null,
  onAdd: (spot: EmptySpot) => void,
): EmptySpot | null {
  const [spot, setSpot] = useState<EmptySpot | null>(null);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const getLayoutRef = useRef(getLayout);
  getLayoutRef.current = getLayout;
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
        setSpot(
          buttons === 0 && target
            ? findSpot(stage, getLayoutRef.current(), allowNewRows, clientX, clientY)
            : null,
        );
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
      const found = findSpot(stage, getLayoutRef.current(), allowNewRows, event.clientX, event.clientY);
      if (!found) return;
      setSpot(null);
      onAddRef.current(found);
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
  }, [allowNewRows, enabled, stage]);
  return enabled ? spot : null;
}

export function EmptySpotOutline({ spot }: { spot: EmptySpot | null }) {
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
