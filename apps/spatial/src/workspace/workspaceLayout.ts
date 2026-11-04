import {
  assertOnirigiriLayout,
  type OnirigiriLayout,
  type WorkspaceColumn,
} from "@riteofstring/onirigiri";

import type { WorkspaceLayoutMode } from "./useWorkspacePanes";

export function readPaneLayout(mode: WorkspaceLayoutMode): OnirigiriLayout | null {
  try {
    const layout = JSON.parse(
      localStorage.getItem(`onirigiri-t3:layout:${mode}`) ?? "null",
    ) as OnirigiriLayout;
    assertOnirigiriLayout(layout);
    return layout.id === "onirigiri-t3" ? layout : null;
  } catch {
    return null;
  }
}

export function writePaneLayout(mode: WorkspaceLayoutMode, layout: OnirigiriLayout) {
  try {
    localStorage.setItem(`onirigiri-t3:layout:${mode}`, JSON.stringify(layout));
  } catch {}
}

export function createPaneLayoutPersistence(mode: WorkspaceLayoutMode) {
  let pending: OnirigiriLayout | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pending) writePaneLayout(mode, pending);
    pending = null;
  };
  return {
    save(layout: OnirigiriLayout) {
      pending = layout;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, 200);
    },
    flush,
  };
}

const slot = (column: WorkspaceColumn) => column.slotIndex ?? column.index;

export function reconcilePaneLayout(
  fresh: OnirigiriLayout,
  current: OnirigiriLayout,
  focusedPaneId?: string | null,
): OnirigiriLayout {
  const liveIds = new Set(fresh.panes.map((pane) => pane.paneId));
  const columns = current.columns
    .map((column) => ({
      ...column,
      cells: column.cells.filter((cell) => cell.paneId === null || liveIds.has(cell.paneId)),
    }))
    .filter((column) => column.cells.length > 0);
  const ownerByPane = new Map(
    columns.flatMap((column) => column.cells.map((cell) => [cell.paneId, column] as const)),
  );
  const columnIds = new Set(columns.map((column) => column.columnId));

  for (const source of fresh.columns) {
    const neighbors = fresh.columns
      .filter((column) => column.planeIndex === source.planeIndex)
      .toSorted((a, b) => slot(a) - slot(b));
    const at = neighbors.indexOf(source);
    const before = neighbors.slice(0, at).toReversed();
    const after = neighbors.slice(at + 1);
    for (const cell of source.cells) {
      if (cell.paneId === null || ownerByPane.has(cell.paneId)) continue;
      const previous = before
        .flatMap((column) => column.cells.toReversed())
        .map((item) => ownerByPane.get(item.paneId))
        .find(Boolean);
      const next = after
        .flatMap((column) => column.cells)
        .map((item) => ownerByPane.get(item.paneId))
        .find(Boolean);
      const anchor = previous ?? next;
      let planeIndex = anchor?.planeIndex ?? source.planeIndex;
      if (!anchor && columns.some((column) => column.planeIndex === planeIndex)) {
        planeIndex = Math.max(...columns.map((column) => column.planeIndex)) + 1;
      }
      const slotIndex = anchor ? slot(anchor) + (previous ? 1 : 0) : slot(source);
      for (const column of columns) {
        if (column.planeIndex === planeIndex && slot(column) >= slotIndex) {
          column.slotIndex = slot(column) + 1;
        }
      }
      let columnId = `spatial:${cell.paneId}`;
      for (let suffix = 1; columnIds.has(columnId); suffix += 1)
        columnId = `spatial:${cell.paneId}:${suffix}`;
      columnIds.add(columnId);
      const reference = [anchor, ...columns].find(
        (column) =>
          column?.planeIndex === planeIndex &&
          column.cells.length === 1 &&
          column.cells[0]!.heightPx !== undefined,
      );
      const heightPx = cell.heightPx ?? reference?.cells[0]!.heightPx;
      const added = {
        ...source,
        columnId,
        cells: [heightPx === undefined ? { ...cell } : { ...cell, heightPx }],
        planeIndex,
        slotIndex,
      };
      columns.push(added);
      ownerByPane.set(cell.paneId, added);
    }
  }
  const ordered = columns.toSorted((a, b) => a.planeIndex - b.planeIndex || slot(a) - slot(b));
  const selectedId =
    focusedPaneId ??
    current.columns.find(
      (column) =>
        column.planeIndex === current.cursor.row && slot(column) === current.cursor.column,
    )?.cells[current.cursor.split]?.paneId;
  const selected = selectedId && !ownerByPane.has(selectedId) ? fresh.panes[0]?.paneId : selectedId;
  const owner = selected ? ownerByPane.get(selected) : undefined;
  return {
    ...fresh,
    columns: ordered.map((column, index) => ({ ...column, index })),
    panes: fresh.panes.map((pane) => ({
      ...pane,
      columnId: ownerByPane.get(pane.paneId)!.columnId,
    })),
    cursor: owner
      ? {
          column: slot(owner),
          row: owner.planeIndex,
          split: owner.cells.findIndex((cell) => cell.paneId === selected),
        }
      : current.cursor,
  };
}

export function threadLayoutPositions(layout: OnirigiriLayout) {
  const threadIds = new Set(
    layout.panes.filter((pane) => pane.surfaceKind === "thread").map((pane) => pane.paneId),
  );
  return layout.columns.flatMap((column) =>
    column.cells.flatMap((cell) =>
      cell.paneId !== null && threadIds.has(cell.paneId)
        ? [{ paneId: cell.paneId, plane: column.planeIndex, slot: slot(column) }]
        : [],
    ),
  );
}

export interface PanePlacement {
  readonly plane: number;
  readonly slot: number;
  readonly newPlane: boolean;
  readonly matchPaneId?: string | null;
}

export function placePane(
  layout: OnirigiriLayout,
  paneId: string,
  placement: PanePlacement,
): OnirigiriLayout {
  const moving = layout.columns.find(
    (column) => column.cells.length === 1 && column.cells[0]!.paneId === paneId,
  );
  if (!moving) return layout;
  const rest = layout.columns
    .filter((column) => column !== moving)
    .map((column) => ({
      ...column,
      slotIndex:
        column.planeIndex === moving.planeIndex && slot(column) > slot(moving)
          ? slot(column) - 1
          : slot(column),
    }));
  const offset = Math.max(0, -placement.slot);
  const target = placement.slot + offset;
  const occupied = rest.some(
    (column) => column.planeIndex === placement.plane && slot(column) + offset === target,
  );
  const shifted = rest.map((column) => {
    const moved = { ...column, slotIndex: slot(column) + offset };
    if (placement.newPlane)
      return moved.planeIndex >= placement.plane
        ? { ...moved, planeIndex: moved.planeIndex + 1 }
        : moved;
    return occupied && moved.planeIndex === placement.plane && moved.slotIndex >= target
      ? { ...moved, slotIndex: moved.slotIndex + 1 }
      : moved;
  });
  const match = layout.columns.find(
    (column) =>
      column.cells.length === 1 && column.cells[0]!.paneId === placement.matchPaneId,
  );
  const heightPx = match ? match.cells[0]!.heightPx : moving.cells[0]!.heightPx;
  const { heightPx: _previous, ...cell } = moving.cells[0]!;
  const placed = {
    ...moving,
    cells: [heightPx === undefined ? cell : { ...cell, heightPx }],
    planeIndex: placement.plane,
    slotIndex: target,
  };
  const columns = [...shifted, placed]
    .toSorted((a, b) => a.planeIndex - b.planeIndex || slot(a) - slot(b))
    .map((column, index) => ({ ...column, index }));
  return {
    ...layout,
    columns,
    cursor: { column: target, row: placement.plane, split: 0 },
  };
}
