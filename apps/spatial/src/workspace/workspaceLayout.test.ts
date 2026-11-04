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
  createPaneLayoutPersistence,
  placePane,
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

it("gives a pane added to a resized row that row's height", () => {
  const panes = [pane("resized", 0, 0), pane("other", 1, 0)];
  const { scene, cursor } = createWorkspaceScene({ gridAxes: "spatial", panes });
  const engine = new OnirigiriLayoutEngine(scene);
  const store = new OnirigiriLayoutStore(engine, scene, cursor);
  store.resizePaneRow("resized", 300);
  const next = createWorkspaceScene({
    gridAxes: "spatial",
    panes: [pane("resized", 0, 0), pane("added", 0, 1), pane("other", 1, 0)],
  });
  store.restoreLayout(
    reconcilePaneLayout(
      serializeWorkspaceLayout(next.scene, next.cursor),
      serializeWorkspaceLayout(engine.toScene(), store.getSnapshot().cursor),
    ),
    { keepPresentation: true },
  );
  const boxes = Object.fromEntries(engine.paneWorldBoxes(viewport).map((box) => [box.paneId, box]));
  expect(boxes.added?.height).toBe(300);
  expect(boxes.other?.height).not.toBe(300);
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

it("keeps an empty grid selection when panes arrive and after serializing the layout", () => {
  const panes = [pane("origin", 0, 0), pane("right", 0, 2), pane("lower", 2, 0)];
  const initial = createWorkspaceScene({ id: "onirigiri-t3", gridAxes: "spatial", panes });
  const engine = new OnirigiriLayoutEngine(initial.scene);
  const store = new OnirigiriLayoutStore(engine, initial.scene, initial.cursor);
  expect(store.moveFocus("right")).toBe(true);
  expect(store.getSnapshot()).toMatchObject({
    cursor: { column: 1, row: 0, split: 0 },
    focusedPaneId: null,
  });
  expect(store.moveFocus("down")).toBe(true);
  const current = serializeWorkspaceLayout(engine.toScene(), store.getSnapshot().cursor);
  const fresh = layoutFor([...panes, pane("new-project", 3, 0)]);
  const reconciled = reconcilePaneLayout(fresh, current);
  assertOnirigiriLayout(reconciled);
  store.restoreLayout(reconciled, { keepPresentation: true });
  expect(store.getSnapshot()).toMatchObject({
    cursor: { column: 1, row: 1, split: 0 },
    focusedPaneId: null,
  });
  expect(reconciled.panes).toHaveLength(4);

  const restored = createWorkspaceScene({ initialLayout: JSON.parse(JSON.stringify(reconciled)) });
  const restoredStore = new OnirigiriLayoutStore(
    new OnirigiriLayoutEngine(restored.scene),
    restored.scene,
    restored.cursor,
  );
  expect(restoredStore.getSnapshot()).toMatchObject({
    cursor: { column: 1, row: 1, split: 0 },
    focusedPaneId: null,
  });
});

it("keeps negative empty coordinates while honoring an explicit pane selection", () => {
  const fresh = layoutFor([pane("origin", 0, 0), pane("other", 1, 1)]);
  const current = { ...fresh, cursor: { column: -3, row: -2, split: 0 } };
  expect(reconcilePaneLayout(fresh, current).cursor).toEqual(current.cursor);
  const selected = reconcilePaneLayout(fresh, current, "other");
  expect(selected.cursor).toEqual({ column: 1, row: 1, split: 0 });

  const removed = reconcilePaneLayout(layoutFor([pane("origin", 0, 0)]), selected);
  expect(removed.cursor).toEqual({ column: 0, row: 0, split: 0 });
});

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

it("gives a newly encountered project its own row without moving a user-arranged row", () => {
  const current = layoutFor([pane("existing", 0, 0)]);
  current.columns[0]!.planeIndex = 1;
  const fresh = layoutFor([
    pane("existing", 0, 0),
    pane("new-project", 1, 0),
    pane("same-project", 1, 1),
  ]);
  const next = reconcilePaneLayout(fresh, current);
  assertOnirigiriLayout(next);
  expect(threadLayoutPositions(next)).toEqual([
    { paneId: "existing", plane: 1, slot: 0 },
    { paneId: "new-project", plane: 2, slot: 0 },
    { paneId: "same-project", plane: 2, slot: 1 },
  ]);
});

it("coalesces repeated resizing writes and flushes the latest arrangement before reload", () => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const persistence = createPaneLayoutPersistence("rows");
  persistence.save(layoutFor([pane("one", 0, 0)]));
  vi.advanceTimersByTime(100);
  persistence.save(layoutFor([pane("one", 0, 2)]));
  vi.advanceTimersByTime(100);
  expect(readPaneLayout("rows")).toBeNull();
  vi.advanceTimersByTime(100);
  expect(threadLayoutPositions(readPaneLayout("rows")!)).toEqual([
    { paneId: "one", plane: 0, slot: 2 },
  ]);
  persistence.save(layoutFor([pane("one", 0, 4)]));
  persistence.flush();
  expect(threadLayoutPositions(readPaneLayout("rows")!)).toEqual([
    { paneId: "one", plane: 0, slot: 4 },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("places a new pane before a row's first pane or in a new row", () => {
  const panes = [pane("a", 0, 0), pane("b", 0, 1), pane("c", 1, 0), pane("new", 0, 2)];
  const { scene, cursor } = createWorkspaceScene({ gridAxes: "spatial", panes });
  const layout = serializeWorkspaceLayout(scene, cursor);
  const where = (next: typeof layout) =>
    Object.fromEntries(
      next.columns.map((column) => [
        column.cells[0]!.paneId,
        [column.planeIndex, column.slotIndex ?? column.index],
      ]),
    );
  const before = placePane(layout, "new", { plane: 0, slot: 0, newPlane: false });
  expect(where(before)).toEqual({ new: [0, 0], a: [0, 1], b: [0, 2], c: [1, 0] });
  expect(before.cursor).toMatchObject({ row: 0, column: 0 });
  const between = placePane(layout, "new", { plane: 1, slot: 0, newPlane: true });
  expect(where(between)).toEqual({ a: [0, 0], b: [0, 1], new: [1, 0], c: [2, 0] });
  expect(() => assertOnirigiriLayout(between)).not.toThrow();
});

it("places a new pane in an empty grid cell without moving other panes", () => {
  const panes = [pane("a", 0, 0), pane("b", 1, 0), pane("new", 0, 1)];
  const { scene, cursor } = createWorkspaceScene({ gridAxes: "spatial", panes });
  const layout = serializeWorkspaceLayout(scene, cursor);
  const where = (next: typeof layout) =>
    Object.fromEntries(
      next.columns.map((column) => [
        column.cells[0]!.paneId,
        [column.planeIndex, column.slotIndex ?? column.index],
      ]),
    );
  expect(where(placePane(layout, "new", { plane: 1, slot: 3, newPlane: false }))).toEqual({
    a: [0, 0],
    b: [1, 0],
    new: [1, 3],
  });
  expect(where(placePane(layout, "new", { plane: 1, slot: -1, newPlane: false }))).toEqual({
    a: [0, 1],
    b: [1, 1],
    new: [1, 0],
  });
});
