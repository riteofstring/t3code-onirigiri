import type { OnirigiriLayout } from "@riteofstring/onirigiri";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import type { PanePlacement } from "./workspaceLayout";

const DRAG_TOLERANCE_PX = 4;
const DEFAULT_GAP_PX = 8;
const MEASURE_SETTLE_MS = 150;

export interface EmptySpot {
  readonly key: string;
  readonly ownerPaneId: string | null;
  readonly placement: PanePlacement;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface Placed {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly plane: number;
  readonly slot: number;
  readonly draft: boolean;
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

function bands(
  known: Map<number, Band>,
  from: number,
  to: number,
  gap: number,
  size = median(
    [...known.values()].map((band) => band.size),
    0,
  ),
): Map<number, Band> {
  const indexes = [...known.keys()].toSorted((a, b) => a - b);
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

function nearest(panes: readonly Placed[], slot: number): Placed | undefined {
  return panes.toSorted((a, b) => Math.abs(a.slot - slot) - Math.abs(b.slot - slot))[0];
}

function emptyCells(
  stage: HTMLElement,
  world: HTMLElement,
  layout: OnirigiriLayout | null,
  allowNewRows: boolean,
  focusedPaneId: string | null,
  defaultRowHeight: number | null,
): EmptySpot[] {
  const viewElement = stage.querySelector<HTMLElement>('[data-onirigiri-slot="stage"]');
  if (!viewElement || !layout || world.offsetWidth === 0) return [];
  const origin = world.getBoundingClientRect();
  const scale = origin.width / world.offsetWidth || 1;
  if (scale < 0.99) stage.style.setProperty("--spatial-overview-scale", String(scale));
  const toWorld = (x: number, y: number) => ({
    x: (x - origin.left) / scale,
    y: (y - origin.top) / scale,
  });
  const screen = viewElement.getBoundingClientRect();
  const topLeft = toWorld(screen.left - screen.width, screen.top - screen.height);
  const bottomRight = toWorld(screen.right + screen.width, screen.bottom + screen.height);
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
    if (!id || !place) continue;
    const box = element.getBoundingClientRect();
    const start = toWorld(box.left, box.top);
    placed.push({
      id,
      left: start.x,
      top: start.y,
      width: box.width / scale,
      height: box.height / scale,
      draft: element.dataset.onirigiriSurfaceKind === "draft",
      ...place,
    });
  }
  if (placed.length === 0) return [];
  const slots = new Map<number, Band>();
  const planes = new Map<number, Placed[]>();
  for (const pane of placed) {
    if (!slots.has(pane.slot)) slots.set(pane.slot, { start: pane.left, size: pane.width });
    planes.set(pane.plane, [...(planes.get(pane.plane) ?? []), pane]);
  }
  const slotGap = median(
    [...slots].flatMap(([slot, band]) => {
      const next = slots.get(slot + 1);
      return next ? [next.start - band.start - band.size] : [];
    }),
    DEFAULT_GAP_PX,
  );
  const top = (plane: number) => Math.min(...planes.get(plane)!.map((pane) => pane.top));
  const bottom = (plane: number) =>
    Math.max(...planes.get(plane)!.map((pane) => pane.top + pane.height));
  const rowGap = median(
    [...planes.keys()].flatMap((plane) =>
      planes.has(plane + 1) ? [top(plane + 1) - bottom(plane)] : [],
    ),
    slotGap,
  );
  const columns = bands(slots, topLeft.x, bottomRight.x, slotGap);
  const emptyHeight =
    defaultRowHeight ??
    median(
      placed.map((pane) => pane.height),
      0,
    );
  const rows = bands(
    new Map(
      [...planes.keys()].map((plane) => [
        plane,
        { start: top(plane), size: bottom(plane) - top(plane) },
      ]),
    ),
    topLeft.y,
    bottomRight.y,
    rowGap,
    emptyHeight,
  );
  const occupied = new Set(placed.map(({ plane, slot }) => `${plane}|${slot}`));
  const cells: EmptySpot[] = [];
  for (const [plane, row] of rows) {
    const panes = planes.get(plane);
    if (!panes && !allowNewRows) continue;
    for (const [slot, column] of columns) {
      if (column.start + column.size < topLeft.x || column.start > bottomRight.x) continue;
      if (occupied.has(`${plane}|${slot}`)) continue;
      const match = panes ? nearest(panes, slot) : undefined;
      const height = panes ? (match?.height ?? emptyHeight) : emptyHeight;
      if (row.start + height < topLeft.y || row.start > bottomRight.y || height <= 0) continue;
      const owner = panes
        ? (nearest(
            panes.filter((pane) => !pane.draft),
            slot,
          )?.id ?? null)
        : focusedPaneId;
      cells.push({
        key: `${plane}|${slot}`,
        ownerPaneId: owner,
        placement: panes
          ? { plane, slot, matchPaneId: match?.id ?? null }
          : { plane, slot, heightPx: null },
        left: column.start,
        top: row.start,
        width: column.size,
        height,
      });
    }
  }
  return cells;
}

export function useEmptySpots(
  stage: HTMLElement | null,
  enabled: boolean,
  moving: boolean,
  allowNewRows: boolean,
  getLayout: () => OnirigiriLayout | null,
  getFocusedPaneId: () => string | null,
  defaultRowHeight: number | null,
  revision: unknown,
): { cells: readonly EmptySpot[]; container: HTMLElement | null } {
  const [cells, setCells] = useState<readonly EmptySpot[]>([]);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const latest = useRef({ getLayout, getFocusedPaneId });
  latest.current = { getLayout, getFocusedPaneId };
  useEffect(() => {
    if (!stage || !enabled) {
      setContainer(null);
      return;
    }
    const layer = stage.ownerDocument.createElement("div");
    layer.className = "spatial-empty-cells";
    const attach = () => {
      const world = stage.querySelector<HTMLElement>("[data-onirigiri-world-surface]");
      if (!world) return;
      observer.disconnect();
      world.prepend(layer);
      setContainer(layer);
    };
    const observer = new MutationObserver(attach);
    observer.observe(stage, { childList: true, subtree: true });
    attach();
    return () => {
      observer.disconnect();
      layer.remove();
      setContainer(null);
    };
  }, [enabled, stage]);
  useEffect(() => {
    const world = stage?.querySelector<HTMLElement>("[data-onirigiri-world-surface]");
    if (!stage || !world || !enabled) {
      setCells([]);
      return;
    }
    if (moving) return;
    const measure = () =>
      setCells(
        emptyCells(
          stage,
          world,
          latest.current.getLayout(),
          allowNewRows,
          latest.current.getFocusedPaneId(),
          defaultRowHeight,
        ),
      );
    let timer = setTimeout(measure, MEASURE_SETTLE_MS);
    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, MEASURE_SETTLE_MS);
    });
    resize.observe(stage);
    return () => {
      clearTimeout(timer);
      resize.disconnect();
    };
  }, [allowNewRows, defaultRowHeight, enabled, moving, revision, stage]);
  return { cells: enabled ? cells : [], container };
}

export function EmptySpotGrid({
  cells,
  container,
  showGrid,
  onAdd,
}: {
  cells: readonly EmptySpot[];
  container: HTMLElement | null;
  showGrid: boolean;
  onAdd: (spot: EmptySpot) => void;
}) {
  const press = useRef<{ x: number; y: number } | null>(null);
  if (!container) return null;
  const centre = (event: ReactPointerEvent<HTMLDivElement>) => {
    const cell = event.currentTarget;
    const box = cell.getBoundingClientRect();
    const view = cell.closest('[data-onirigiri-slot="stage"]')?.getBoundingClientRect() ?? box;
    const scale = box.width / cell.offsetWidth || 1;
    const x = (Math.max(box.left, view.left) + Math.min(box.right, view.right)) / 2;
    const y = (Math.max(box.top, view.top) + Math.min(box.bottom, view.bottom)) / 2;
    cell.style.setProperty("--spot-x", `${(x - box.left) / scale}px`);
    cell.style.setProperty("--spot-y", `${(y - box.top) / scale}px`);
    cell.style.setProperty("--spot-scale", String(1 / scale));
  };
  return createPortal(
    cells.map((cell) => (
      <div
        key={cell.key}
        aria-hidden="true"
        className="spatial-empty-cell"
        data-show-grid={String(showGrid)}
        style={{
          transform: `translate(${cell.left}px, ${cell.top}px)`,
          width: cell.width,
          height: cell.height,
        }}
        onPointerEnter={centre}
        onPointerDown={(event) => {
          press.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
        }}
        onClick={(event) => {
          const start = press.current;
          press.current = null;
          if (
            !start ||
            event.button !== 0 ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_TOLERANCE_PX
          )
            return;
          onAdd(cell);
        }}
      >
        <span className="spatial-empty-cell__label">New pane</span>
      </div>
    )),
    container,
  );
}
