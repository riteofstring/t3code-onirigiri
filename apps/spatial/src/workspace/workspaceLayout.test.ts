import {
  assertOnirigiriLayout,
  createWorkspaceScene,
  OnirigiriLayoutEngine,
  OnirigiriLayoutStore,
  serializeWorkspaceLayout,
  type OnirigiriPaneDefinition,
} from "@riteofstring/onirigiri";
import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  panesFillViewport,
  reconcilePaneLayout,
  threadLayoutPositions,
  readPaneLayout,
  writePaneLayout,
} from "./workspaceLayout";

const viewport = { x: 0, y: 0, width: 1600, height: 1000 };
const pane = (paneId: string, planeIndex: number, slotIndex: number): OnirigiriPaneDefinition => ({
  paneId,
  planeIndex,
  slotIndex,
  surfaceKind: "thread",
  title: paneId,
});

it("retains manual sizes when membership changes and applies the row default to new panes", () => {
  const panes = [pane("manual", 0, 0), pane("default", 1, 0)];
  const { scene, cursor } = createWorkspaceScene({ gridAxes: "spatial", panes });
  const engine = new OnirigiriLayoutEngine(scene);
  const store = new OnirigiriLayoutStore(engine, scene, cursor);
  store.resizePaneRow("manual", 300);
  store.resizePaneColumn("manual", { unit: "px", value: 640 });
  store.setPaneDefaults({ paneDefaults: { height: 420 } });
  const next = createWorkspaceScene({
    gridAxes: "spatial",
    panes: [...panes, pane("added", 2, 1)],
    paneDefaults: { height: 420 },
  });
  const layout = reconcilePaneLayout(
    serializeWorkspaceLayout(next.scene, next.cursor),
    serializeWorkspaceLayout(engine.toScene(), store.getSnapshot().cursor),
  );
  store.restoreLayout(layout, { keepPresentation: true });
  const boxes = () =>
    Object.fromEntries(engine.paneWorldBoxes(viewport).map((box) => [box.paneId, box]));
  expect(boxes().manual).toMatchObject({ height: 300, width: 640 });
  expect(boxes().default).toMatchObject({ height: 420 });
  expect(boxes().added).toMatchObject({ height: 420 });

  store.setPaneDefaults({ paneDefaults: { height: 500 } });
  expect(boxes().manual).toMatchObject({ height: 300 });
  expect(boxes().default).toMatchObject({ height: 500 });
  expect(boxes().added).toMatchObject({ height: 500 });
  store.resetWorkspaceSizing(viewport);
  expect(Object.values(boxes()).map((box) => box.height)).toEqual([500, 500, 500]);
});

it("preserves the split proportions of surviving panes when another pane is removed", () => {
  const panes = [
    { ...pane("upper", 0, 0), columnId: "stack", weight: 1 },
    { ...pane("lower", 0, 0), columnId: "stack", weight: 3 },
    pane("removed", 0, 1),
  ];
  const original = createWorkspaceScene({ panes });
  const next = createWorkspaceScene({
    panes: panes.slice(0, 2).map(({ weight: _weight, ...item }) => item),
  });
  const layout = reconcilePaneLayout(
    serializeWorkspaceLayout(next.scene, next.cursor),
    serializeWorkspaceLayout(original.scene, original.cursor),
  );
  const restored = createWorkspaceScene({ initialLayout: layout });
  const engine = new OnirigiriLayoutEngine(restored.scene);
  const boxes = engine.paneWorldBoxes(viewport);
  expect(boxes).toHaveLength(2);
  expect(boxes[1]!.height).toBeCloseTo(boxes[0]!.height * 3);
});

const layoutFor = (panes: OnirigiriPaneDefinition[]) => {
  const { scene, cursor } = createWorkspaceScene({
    id: "onirigiri-t3",
    gridAxes: "spatial",
    panes,
  });
  return serializeWorkspaceLayout(scene, cursor);
};

it("keeps a pane's actual 2D position, identity and size through fresh metadata and membership", () => {
  const panes = [pane("moved", 0, 0), pane("neighbor", 0, 1), pane("removed", 1, 1)];
  const initial = createWorkspaceScene({ id: "onirigiri-t3", gridAxes: "spatial", panes });
  const engine = new OnirigiriLayoutEngine(initial.scene);
  const store = new OnirigiriLayoutStore(engine, initial.scene, initial.cursor);
  store.focusPane("moved");
  store.resizePaneRow("moved", 300);
  store.resizePaneColumn("moved", { unit: "px", value: 640 });
  expect(store.moveFocusedPane("down")).toBe(true);
  expect(store.moveFocusedPane("down")).toBe(true);
  expect(store.moveFocusedPane("left")).toBe(true);
  const current = serializeWorkspaceLayout(engine.toScene(), store.getSnapshot().cursor);
  expect(threadLayoutPositions(current)).toContainEqual({ paneId: "moved", plane: 2, slot: -1 });
  const currentCopy = structuredClone(current);
  const updated = layoutFor([
    { ...panes[0]!, title: "Renamed", data: { revision: 2 } },
    panes[1]!,
    pane("added", 4, 0),
  ]);
  const reconciled = reconcilePaneLayout(updated, current, "moved");
  assertOnirigiriLayout(reconciled);
  expect(current).toEqual(currentCopy);
  store.restoreLayout(reconciled, { keepPresentation: true });
  const after = serializeWorkspaceLayout(engine.toScene(), store.getSnapshot().cursor);
  expect(threadLayoutPositions(after)).toContainEqual({ paneId: "moved", plane: 2, slot: -1 });
  expect(after.panes.find((p) => p.paneId === "moved")).toMatchObject({
    title: "Renamed",
    data: { revision: 2 },
  });
  expect(after.panes.some((p) => p.paneId === "removed")).toBe(false);
  expect(after.panes.some((p) => p.paneId === "added")).toBe(true);
  expect(engine.paneWorldBoxes(viewport).find((box) => box.paneId === "moved")).toMatchObject({
    width: 640,
    height: 300,
  });
  expect(store.focusedPaneId()).toBe("moved");
});

it("opens a new tool to the right of its moved owner and shifts the occupied neighbor", () => {
  const fresh = layoutFor([pane("owner", 0, 0), pane("new-tool", 0, 1), pane("neighbor", 0, 2)]);
  const current = layoutFor([pane("owner", 0, 4), pane("neighbor", 0, 5)]);
  for (const column of current.columns) column.planeIndex = 3;
  const reconciled = reconcilePaneLayout(fresh, current, "new-tool");
  assertOnirigiriLayout(reconciled);
  expect(threadLayoutPositions(reconciled)).toEqual([
    { paneId: "owner", plane: 3, slot: 4 },
    { paneId: "new-tool", plane: 3, slot: 5 },
    { paneId: "neighbor", plane: 3, slot: 6 },
  ]);
  expect(reconciled.cursor).toEqual({ column: 5, row: 3, split: 0 });
});

it("preserves separate strip and rows arrangements across reload and excludes stale panes", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const strip = layoutFor([pane("saved", 0, 6)]);
  const rows = layoutFor([pane("saved", 0, 0), pane("archived", 1, 2)]);
  rows.columns[0]!.planeIndex = 3;
  rows.columns[0]!.slotIndex = -2;
  rows.columns[1]!.planeIndex = 5;
  writePaneLayout("strip", strip);
  writePaneLayout("rows", rows);
  const restored = reconcilePaneLayout(layoutFor([pane("saved", 0, 0)]), readPaneLayout("rows")!);
  const { scene } = createWorkspaceScene({ initialLayout: restored });
  expect(scene.panes.map((pane) => pane.paneId)).toEqual(["saved"]);
  expect(threadLayoutPositions(restored)).toEqual([{ paneId: "saved", plane: 3, slot: -2 }]);
  expect(readPaneLayout("strip")).toEqual(strip);
  storage.set("onirigiri-t3:layout:rows", "malformed");
  expect(readPaneLayout("rows")).toBeNull();
  storage.set("onirigiri-t3:layout:rows", JSON.stringify({ ...rows, id: "another-app" }));
  expect(readPaneLayout("rows")).toBeNull();
});

it("identifies full sizes after reload, and stops offering Restore after a resize or new pane", () => {
  const full = layoutFor([
    { ...pane("one", 0, 0), columnWidth: { unit: "px", value: 900 }, heightPx: 700 },
    { ...pane("two", 0, 1), columnWidth: { unit: "px", value: 900 }, heightPx: 700 },
  ]);
  expect(panesFillViewport(JSON.parse(JSON.stringify(full)), { width: 900, height: 700 })).toBe(
    true,
  );
  const shorter = structuredClone(full);
  shorter.columns[0]!.cells[0]!.heightPx = 450;
  expect(panesFillViewport(shorter, { width: 900, height: 700 })).toBe(false);
  const added = reconcilePaneLayout(
    layoutFor([pane("one", 0, 0), pane("two", 0, 1), pane("new", 0, 2)]),
    full,
  );
  expect(panesFillViewport(added, { width: 900, height: 700 })).toBe(false);
  expect(panesFillViewport(full, { width: 1100, height: 700 })).toBe(false);
});

afterEach(() => vi.unstubAllGlobals());
