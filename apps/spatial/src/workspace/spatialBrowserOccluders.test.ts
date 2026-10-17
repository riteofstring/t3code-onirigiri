// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { browserSurfaceClipPath } from "@t3tools/web/src/browser/browserSurfaceProjection";

import { spatialBrowserOccluders } from "./spatialBrowserOccluders";

afterEach(() => {
  document.body.replaceChildren();
});

function createWorkspace(parent: HTMLElement = document.body) {
  const spatial = document.createElement("div");
  spatial.className = "spatial-workspace";
  const workspace = document.createElement("div");
  workspace.className = "onirigiri-workspace";
  const stage = document.createElement("div");
  stage.dataset.onirigiriSlot = "stage";
  const world = document.createElement("div");
  const pane = document.createElement("section");
  const slot = document.createElement("div");
  pane.append(slot);
  world.append(pane);
  stage.append(world);
  workspace.append(stage);
  spatial.append(workspace);
  parent.append(spatial);
  return { spatial, stage, pane, slot };
}

function createMinimap(parent: HTMLElement, bounds = new DOMRect(200, 50, 100, 150)) {
  const minimap = document.createElement("div");
  minimap.className = "onirigiri-workspace__minimap";
  minimap.getBoundingClientRect = () => bounds;
  parent.append(minimap);
  return minimap;
}

function guestClip(slot: HTMLElement) {
  const bounds = new DOMRect(100, 50, 200, 150);
  return browserSurfaceClipPath(
    bounds,
    { width: 400, height: 300 },
    bounds,
    spatialBrowserOccluders(slot).map((element) => element.getBoundingClientRect()),
  );
}

describe("spatialBrowserOccluders", () => {
  it("updates clipping when the minimap is added, replaced and removed", () => {
    const { stage, slot } = createWorkspace();
    expect(guestClip(slot)).toBe('path("M0 0H400V300H0Z")');

    const first = createMinimap(stage);
    expect(guestClip(slot)).toBe('path("M0 0H200V300H0Z")');

    const replacement = createMinimap(stage, new DOMRect(100, 125, 200, 75));
    first.replaceWith(replacement);
    expect(spatialBrowserOccluders(slot)).toEqual([replacement]);
    expect(guestClip(slot)).toBe('path("M0 0H400V150H0Z")');

    replacement.remove();
    expect(guestClip(slot)).toBe('path("M0 0H400V300H0Z")');
  });

  it("keeps nested workspaces and pane descendants out of the outer guest clip", () => {
    const outer = createWorkspace();
    createMinimap(outer.stage);
    createMinimap(outer.pane, new DOMRect(100, 50, 200, 150));
    const inner = createWorkspace(outer.pane);
    createMinimap(inner.stage, new DOMRect(100, 50, 100, 150));

    expect(guestClip(outer.slot)).toBe('path("M0 0H200V300H0Z")');
  });

  it("scopes each guest to its workspace even when other minimaps overlap", () => {
    const first = createWorkspace();
    const second = createWorkspace();
    createMinimap(first.stage);
    createMinimap(second.stage, new DOMRect(100, 50, 100, 150));

    expect(guestClip(first.slot)).toBe('path("M0 0H200V300H0Z")');
    expect(guestClip(second.slot)).toBe('path("M200 0H400V300H200Z")');
  });

  it("does not treat a non-HTML stage child as workspace chrome", () => {
    const { stage, slot } = createWorkspace();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("onirigiri-workspace__minimap");
    svg.getBoundingClientRect = () => new DOMRect(100, 50, 200, 150);
    stage.append(svg);

    expect(guestClip(slot)).toBe('path("M0 0H400V300H0Z")');
  });

  it("clips the toolbar as controls expand left on the same row", () => {
    const { spatial, slot } = createWorkspace();
    const controls = document.createElement("div");
    controls.dataset.spatialWorkspaceControls = "";
    const surface = document.createElement("div");
    let width = 20;
    surface.getBoundingClientRect = () => new DOMRect(300 - width, 50, width, 20);
    controls.append(surface);
    spatial.append(controls);

    expect(spatialBrowserOccluders(slot)).toEqual([surface]);
    const closed = guestClip(slot);
    expect(closed).toBe('path("M0 40H400V300H0Z M0 0H360V40H0Z")');
    width = 100;
    expect(guestClip(slot)).toBe('path("M0 40H400V300H0Z M0 0H200V40H0Z")');
    width = 200;
    expect(guestClip(slot)).toBe('path("M0 40H400V300H0Z")');
    width = 20;
    expect(guestClip(slot)).toBe(closed);
  });

  it("does not clip one workspace with another workspace's controls", () => {
    const first = createWorkspace();
    const second = createWorkspace();
    const controls = document.createElement("div");
    controls.dataset.spatialWorkspaceControls = "";
    const trigger = document.createElement("button");
    trigger.getBoundingClientRect = () => new DOMRect(100, 50, 200, 150);
    controls.append(trigger);
    second.spatial.append(controls);

    expect(guestClip(first.slot)).toBe('path("M0 0H400V300H0Z")');
    expect(guestClip(second.slot)).toBe("inset(50%)");
  });

  it("leaves a guest unclipped when it has no owning stage", () => {
    const slot = document.createElement("div");
    document.body.append(slot);

    expect(guestClip(slot)).toBe('path("M0 0H400V300H0Z")');
  });
});
