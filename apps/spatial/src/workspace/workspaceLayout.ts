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
  } catch {
    // Arrangement still works when browser storage is unavailable.
  }
}

const slot = (column: WorkspaceColumn) => column.slotIndex ?? column.index;

/** Keeps the engine's arrangement while reconciling live pane identities and metadata. */
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
      const planeIndex = anchor?.planeIndex ?? source.planeIndex;
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
      const added = { ...source, columnId, cells: [{ ...cell }], planeIndex, slotIndex };
      columns.push(added);
      ownerByPane.set(cell.paneId, added);
    }
  }
  const ordered = columns.toSorted((a, b) => a.planeIndex - b.planeIndex || slot(a) - slot(b));
  const owner = focusedPaneId ? ownerByPane.get(focusedPaneId) : undefined;
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
          split: owner.cells.findIndex((cell) => cell.paneId === focusedPaneId),
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

export function panesFillViewport(
  layout: OnirigiriLayout,
  viewport: { width: number; height: number },
) {
  const occupied = layout.columns.filter((column) => column.cells.some((cell) => cell.paneId));
  return (
    occupied.length > 0 &&
    occupied.every(
      (column) =>
        column.widthSpec.unit === "px" &&
        column.widthSpec.value >= viewport.width &&
        column.cells.every((cell) => !cell.paneId || (cell.heightPx ?? 0) >= viewport.height),
    )
  );
}
