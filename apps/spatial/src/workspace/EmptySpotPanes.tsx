import type { OnirigiriLayout } from "@riteofstring/onirigiri";
import { useEffect, useRef, useState } from "react";

import type { PanePlacement } from "./workspaceLayout";

const DRAG_TOLERANCE_PX = 4;
const DEFAULT_GAP_PX = 8;
const IGNORED =
  'button, a, input, textarea, select, [role="menu"], [role="dialog"], [data-onirigiri-slot="pane"]';

export interface EmptySpot {
  readonly ownerPaneId: string | null;
  readonly placement: PanePlacement;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly visible: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

interface Placed {
  readonly id: string;
  readonly box: DOMRect;
  readonly plane: number;
  readonly slot: number;
}

interface Band {
  readonly start: number;
  readonly size: number;
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function bands(known: Map<number, Band>, from: number, to: number, gap: number): Map<number, Band> {
  const indexes = [...known.keys()].toSorted((a, b) => a - b);
  const size = median([...known.values()].map((band) => band.size), 0);
  const result = new Map(known);
  if (size <= 0) return result;
  for (let index = indexes[0]! - 1; ; index -= 1) {
    const next = result.get(index + 1)!;
    const band = { start: next.start - gap - size, size };
    if (band.start + band.size < from) break;
    result.set(index, band);
  }
  for (let index = indexes[0]! + 1; ; index += 1) {
    if (result.has(index)) continue;
    const previous = result.get(index - 1)!;
    const band = { start: previous.start + previous.size + gap, size };
    if (band.start > to && index > indexes.at(-1)!) break;
    result.set(index, band);
  }
  return result;
}

function emptyCells(
  stage: HTMLElement,
  layout: OnirigiriLayout | null,
  allowNewRows: boolean,
  focusedPaneId: string | null,
): EmptySpot[] {
  const world = stage.querySelector<HTMLElement>('[data-onirigiri-slot="stage"]');
  if (!world || !layout) return [];
  const view = world.getBoundingClientRect();
  const located = new Map(
    layout.columns.flatMap((column) =>
      column.cells.flatMap((cell) =>
        cell.paneId === null
          ? []
          : [
              [
                cell.paneId,
                { plane: column.planeIndex, slot: column.slotIndex ?? column.index },
              ] as const,
            ],
      ),
    ),
  );
  const placed: Placed[] = [];
  for (const element of stage.querySelectorAll<HTMLElement>('[data-onirigiri-slot="pane"]')) {
    const id = element.dataset.onirigiriPaneId;
    const place = id ? located.get(id) : undefined;
    if (id && place) placed.push({ id, box: element.getBoundingClientRect(), ...place });
  }
  if (placed.length === 0) return [];
  const slots = new Map<number, Band>();
  const planes = new Map<number, { start: number; end: number }>();
  for (const { box, plane, slot } of placed) {
    if (!slots.has(slot)) slots.set(slot, { start: box.left, size: box.width });
    const row = planes.get(plane);
    planes.set(plane, {
      start: Math.min(row?.start ?? box.top, box.top),
      end: Math.max(row?.end ?? box.bottom, box.bottom),
    });
  }
  const slotGap = median(
    [...slots].flatMap(([slot, band]) => {
      const next = slots.get(slot + 1);
      return next ? [next.start - band.start - band.size] : [];
    }),
    DEFAULT_GAP_PX,
  );
  const rowGap = median(
    [...planes].flatMap(([plane, band]) => {
      const next = planes.get(plane + 1);
      return next ? [next.start - band.end] : [];
    }),
    slotGap,
  );
  const columns = bands(slots, view.left, view.right, slotGap);
  const rowHeight = median(
    [...planes.values()].map((band) => band.end - band.start),
    view.height,
  );
  const planeIndexes = [...planes.keys()].toSorted((a, b) => a - b);
  const first = planeIndexes[0]!;
  const last = planeIndexes.at(-1)!;
  const rows = planeIndexes.map((plane) => ({
    plane,
    newPlane: false,
    top: planes.get(plane)!.start,
    height: planes.get(plane)!.end - planes.get(plane)!.start,
  }));
  if (allowNewRows) {
    rows.push(
      {
        plane: first,
        newPlane: true,
        top: planes.get(first)!.start - rowGap - rowHeight,
        height: rowHeight,
      },
      { plane: last + 1, newPlane: true, top: planes.get(last)!.end + rowGap, height: rowHeight },
    );
  }
  const occupied = new Set(placed.map(({ plane, slot }) => `${plane}|${slot}`));
  const nearestIn = (plane: number, slot: number) =>
    placed
      .filter((pane) => pane.plane === plane && !pane.id.startsWith("draft:"))
      .toSorted((a, b) => Math.abs(a.slot - slot) - Math.abs(b.slot - slot))[0]?.id ?? null;
  const origin = stage.getBoundingClientRect();
  const cells: EmptySpot[] = [];
  for (const row of rows) {
    if (row.top + row.height < view.top || row.top > view.bottom) continue;
    for (const [slot, column] of columns) {
      if (column.start + column.size < view.left || column.start > view.right) continue;
      if (!row.newPlane && occupied.has(`${row.plane}|${slot}`)) continue;
      const left = Math.max(column.start, view.left);
      const top = Math.max(row.top, view.top);
      const right = Math.min(column.start + column.size, view.right);
      const bottom = Math.min(row.top + row.height, view.bottom);
      cells.push({
        ownerPaneId: row.newPlane ? focusedPaneId : nearestIn(row.plane, slot),
        placement: { plane: row.plane, slot, newPlane: row.newPlane },
        left: column.start - origin.left,
        top: row.top - origin.top,
        width: column.size,
        height: row.height,
        visible: {
          left: left - column.start,
          top: top - row.top,
          width: right - left,
          height: bottom - top,
        },
      });
    }
  }
  return cells;
}

function cellAt(stage: HTMLElement, cells: readonly EmptySpot[], x: number, y: number) {
  const origin = stage.getBoundingClientRect();
  const localX = x - origin.left;
  const localY = y - origin.top;
  return (
    cells.find(
      (cell) =>
        localX >= cell.left &&
        localX <= cell.left + cell.width &&
        localY >= cell.top &&
        localY <= cell.top + cell.height,
    ) ?? null
  );
}

export function useEmptySpotPanes(
  stage: HTMLElement | null,
  enabled: boolean,
  allowNewRows: boolean,
  getLayout: () => OnirigiriLayout | null,
  getFocusedPaneId: () => string | null,
  revision: unknown,
  onAdd: (spot: EmptySpot) => void,
): { cells: readonly EmptySpot[]; hovered: EmptySpot | null } {
  const [cells, setCells] = useState<readonly EmptySpot[]>([]);
  const [hovered, setHovered] = useState<EmptySpot | null>(null);
  const latest = useRef({ getLayout, getFocusedPaneId, onAdd });
  latest.current = { getLayout, getFocusedPaneId, onAdd };
  useEffect(() => {
    if (!stage || !enabled) {
      setCells([]);
      setHovered(null);
      return;
    }
    let current: readonly EmptySpot[] = [];
    const measure = () => {
      current = emptyCells(
        stage,
        latest.current.getLayout(),
        allowNewRows,
        latest.current.getFocusedPaneId(),
      );
      setCells(current);
    };
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(measure);
    });
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    resize.observe(stage);
    let down: { x: number; y: number } | null = null;
    const empty = (event: PointerEvent | MouseEvent) =>
      event.target instanceof Element && !event.target.closest(IGNORED);
    const move = (event: PointerEvent) =>
      setHovered(
        event.buttons === 0 && empty(event)
          ? cellAt(stage, current, event.clientX, event.clientY)
          : null,
      );
    const leave = () => setHovered(null);
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
      const found = cellAt(stage, current, event.clientX, event.clientY);
      if (!found) return;
      setHovered(null);
      latest.current.onAdd(found);
    };
    stage.addEventListener("pointermove", move, { passive: true });
    stage.addEventListener("pointerleave", leave);
    stage.addEventListener("pointerdown", press, { capture: true });
    stage.addEventListener("click", click);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", leave);
      stage.removeEventListener("pointerdown", press, { capture: true });
      stage.removeEventListener("click", click);
    };
  }, [allowNewRows, enabled, revision, stage]);
  return enabled ? { cells, hovered } : { cells: [], hovered: null };
}

export function EmptySpotGrid({
  cells,
  hovered,
  showGrid,
}: {
  cells: readonly EmptySpot[];
  hovered: EmptySpot | null;
  showGrid: boolean;
}) {
  return (
    <>
      {showGrid
        ? cells.map((cell) =>
            cell === hovered ? null : (
              <div
                key={`${cell.placement.newPlane}|${cell.placement.plane}|${cell.placement.slot}`}
                aria-hidden="true"
                className="pointer-events-none absolute z-10 rounded-lg bg-black/[0.15]"
                style={{ left: cell.left, top: cell.top, width: cell.width, height: cell.height }}
              />
            ),
          )
        : null}
      {hovered ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-lg bg-black/[0.3] text-foreground/25"
          style={{
            left: hovered.left,
            top: hovered.top,
            width: hovered.width,
            height: hovered.height,
          }}
        >
          <div className="absolute flex items-center justify-center" style={hovered.visible}>
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      ) : null}
    </>
  );
}
