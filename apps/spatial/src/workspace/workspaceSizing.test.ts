import {
  createWorkspaceScene,
  OnirigiriLayoutEngine,
  OnirigiriLayoutStore,
  serializeWorkspaceLayout,
  type OnirigiriPaneDefinition,
} from "@riteofstring/onirigiri";
import { expect, it } from "vite-plus/test";

import { keepPaneSizes } from "./workspaceSizing";

const viewport = { x: 0, y: 0, width: 1600, height: 1000 };
const pane = (paneId: string, planeIndex: number, slotIndex: number): OnirigiriPaneDefinition => ({
  paneId,
  planeIndex,
  slotIndex,
  surfaceKind: "chat",
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
  const layout = keepPaneSizes(serializeWorkspaceLayout(next.scene, next.cursor), engine.toScene());
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
  const layout = keepPaneSizes(serializeWorkspaceLayout(next.scene, next.cursor), original.scene);
  const restored = createWorkspaceScene({ initialLayout: layout });
  const engine = new OnirigiriLayoutEngine(restored.scene);
  const boxes = engine.paneWorldBoxes(viewport);
  expect(boxes).toHaveLength(2);
  expect(boxes[1]!.height).toBeCloseTo(boxes[0]!.height * 3);
});
