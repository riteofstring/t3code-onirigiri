// @vitest-environment jsdom
import { act, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { WorkspaceTooltips } from "./WorkspaceTooltips";
import { useWorkspacePreferences } from "./useWorkspacePreferences";

let host: HTMLDivElement;
let root: Root;

function Workspace() {
  const [preferences, update] = useWorkspacePreferences();
  const [maximum, setMaximum] = useState(880);
  const [layoutMode, setLayoutMode] = useState<"strip" | "rows">("rows");
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  return (
    <WorkspaceTooltips>
      <WorkspaceToolbar
        focusAnchor="center"
        onToggleAnchor={() => {}}
        controlsRef={setControls}
        shortcuts={{}}
        preferences={preferences}
        focusedRowHeight={null}
        maxRowHeight={maximum}
        maxColumnWidth={900}
        onPreferencesChange={update}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
      />
      {controls && createPortal(<button>Overview</button>, controls)}
      <output>{JSON.stringify(preferences)}</output>
      <span data-layout-mode={layoutMode} />
      <button>Outside</button>
      <button onClick={() => setMaximum(640)}>Shorter view</button>
      <button onClick={() => setMaximum(1000)}>Taller view</button>
      <button onClick={() => setMaximum(60)}>Tiny view</button>
      <textarea aria-label="Terminal input" />
    </WorkspaceTooltips>
  );
}

function button(label: string) {
  const result = [...host.querySelectorAll("button")].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent) === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function settings() {
  return JSON.parse(host.querySelector("output")!.textContent!);
}

async function control(label: string, popover: "Rows" | "Columns") {
  const selector = `input[aria-label="${label}"]`;
  if (!document.querySelector(selector)) {
    await act(() => host.querySelector<HTMLButtonElement>(`[aria-label^="${popover}:"]`)!.click());
  }
  return document.querySelector<HTMLInputElement>(selector)!;
}

function rowHeight() {
  return document.querySelector<HTMLInputElement>('input[aria-label="Row height in pixels"]')!;
}

async function click(label: string) {
  await act(() => {
    const target = button(label);
    target.focus();
    target.click();
  });
}

async function typeHeight(value: string) {
  const input = await control("Row height in pixels", "Rows");
  await act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(target: HTMLElement, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  await act(() => target.dispatchEvent(event));
  return event;
}

async function pointer(type: "pointerenter" | "pointerleave", pointerType = "mouse") {
  await act(() => {
    const event = new Event(type);
    Object.defineProperty(event, "pointerType", { value: pointerType });
    host.querySelector("[data-spatial-workspace-controls]")!.dispatchEvent(event);
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<Workspace />));
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("sets a maximum column width that stays at least the minimum and turns off at 0", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  const maximum = await control("Maximum column width in pixels", "Columns");
  const enter = async (value: string) => {
    await act(() => {
      maximum.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        maximum,
        value,
      );
      maximum.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key(maximum, "Enter");
    return settings().maxColumnWidth;
  };
  expect(maximum.value).toBe("1100");
  expect(await enter("900")).toBe(900);
  expect(await enter("100")).toBe(442);
  expect(await enter("0")).toBe(0);
  expect(maximum.value).toBe("0");
});

it("remembers overview and row defaults across reloads, with a way back to viewport height", async () => {
  expect(settings()).toEqual({
    overviewZoom: "auto",
    rowHeight: "viewport",
    maxRowHeight: 1200,
    columnWidth: 840,
    maxColumnWidth: 1100,
    navigationBar: true,
    maximizeAll: false,
    showGrid: false,
    focusOnClick: false,
    showMinimap: true,
  });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Zoom: Auto"]')!.click());
  await act(() => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (element) => element.textContent === "Near",
    )!;
    option.click();
  });
  expect(document.querySelector('[aria-label="Overview zoom"]')).toBeNull();
  expect(button("Zoom: Near")).toBeTruthy();
  await typeHeight("384");
  expect(settings()).toEqual({
    overviewZoom: "near",
    rowHeight: 384,
    maxRowHeight: 1200,
    columnWidth: 840,
    maxColumnWidth: 1100,
    navigationBar: true,
    maximizeAll: false,
    showGrid: false,
    focusOnClick: false,
    showMinimap: true,
  });

  await act(() => root.unmount());
  root = createRoot(host);
  await act(() => root.render(<Workspace />));
  expect(settings()).toEqual({
    overviewZoom: "near",
    rowHeight: 384,
    maxRowHeight: 1200,
    columnWidth: 840,
    maxColumnWidth: 1100,
    navigationBar: true,
    maximizeAll: false,
    showGrid: false,
    focusOnClick: false,
    showMinimap: true,
  });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("880");
  expect(settings()).toEqual({
    overviewZoom: "near",
    rowHeight: "viewport",
    maxRowHeight: 1200,
    columnWidth: 840,
    maxColumnWidth: 1100,
    navigationBar: true,
    maximizeAll: false,
    showGrid: false,
    focusOnClick: false,
    showMinimap: true,
  });
});

it("applies each slider position as the slider moves", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("300");
  expect(settings().rowHeight).toBe(300);
  await typeHeight("420");
  expect(rowHeight().value).toBe("420");
  expect(settings().rowHeight).toBe(420);
});

it("bounds the slider to the view while preserving fixed heights across resizing", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("720");
  expect(settings().rowHeight).toBe(720);
  await click("Shorter view");
  await control("Row height in pixels", "Rows");
  expect(rowHeight().max).toBe("640");
  expect(rowHeight().value).toBe("640");
  expect(settings().rowHeight).toBe(720);
  await click("Taller view");
  await control("Row height in pixels", "Rows");
  expect(rowHeight().value).toBe("720");
  await typeHeight("1000");
  expect(settings().rowHeight).toBe("viewport");
  await click("Shorter view");
  await control("Row height in pixels", "Rows");
  expect(rowHeight().value).toBe("640");
  await click("Tiny view");
  await control("Row height in pixels", "Rows");
  expect(rowHeight().min).toBe("60");
  expect(rowHeight().max).toBe("60");
  expect(rowHeight().disabled).toBe(true);
});

it("Escape closes the size popover, then Advanced, without undoing an applied height", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("420");
  await key(rowHeight(), "Escape");
  expect(document.querySelector('input[aria-label="Row height in pixels"]')).toBeNull();
  expect(button("Rows: 420px")).toBeTruthy();
  expect(settings().rowHeight).toBe(420);
  await act(() => button("Rows: 420px").focus());
  expect((await key(button("Rows: 420px"), "Escape")).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(button("Advanced workspace controls"));
  expect(button("Advanced workspace controls").getAttribute("aria-expanded")).toBe("false");
  await key(button("Advanced workspace controls"), "Escape");
  expect(document.activeElement).toBe(button("Workspace controls"));
});

it("handles Escape from portalled controls and remembers Advanced after hiding", async () => {
  await click("Workspace controls");
  await act(() => button("Overview").focus());
  expect((await key(button("Overview"), "Escape")).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(button("Workspace controls"));
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await act(() => button("Outside").focus());
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
  await click("Workspace controls");
  expect(button("Advanced workspace controls").getAttribute("aria-expanded")).toBe("true");
  await click("Advanced workspace controls");
  await act(() => button("Outside").focus());
  await click("Workspace controls");
  expect(button("Advanced workspace controls").getAttribute("aria-expanded")).toBe("false");
});

it("opens on mouse hover while touch opens by click and outside press dismisses", async () => {
  vi.useFakeTimers();
  await pointer("pointerenter", "touch");
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
  await click("Workspace controls");
  await act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
  await act(() => button("Outside").focus());
  await pointer("pointerenter");
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("true");
  await pointer("pointerleave");
  await act(() => vi.advanceTimersByTime(600));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
});

it("allows brief mouse detours and keeps Advanced expanded when the toolbar returns", async () => {
  vi.useFakeTimers();
  await pointer("pointerenter");
  await act(() => button("Advanced workspace controls").click());
  await pointer("pointerleave");
  await act(() => vi.advanceTimersByTime(400));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("true");
  await pointer("pointerenter");
  await act(() => vi.advanceTimersByTime(600));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("true");
  await pointer("pointerleave");
  await act(() => vi.advanceTimersByTime(600));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
  await pointer("pointerenter");
  expect(button("Advanced workspace controls").getAttribute("aria-expanded")).toBe("true");
});

it("keeps hovered controls available when a terminal takes focus, including during the grace period", async () => {
  vi.useFakeTimers();
  const terminal = host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Terminal input"]',
  )!;
  await pointer("pointerenter");
  await act(() => button("Overview").focus());
  await act(() => terminal.focus());
  await act(() => vi.advanceTimersByTime(1000));
  expect(document.activeElement).toBe(terminal);
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("true");
  await act(() => button("Overview").focus());
  await pointer("pointerleave");
  await act(() => terminal.focus());
  await act(() => vi.advanceTimersByTime(400));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("true");
  await act(() => vi.advanceTimersByTime(200));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
});

it("keeps settings usable when storage cannot be written", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("512");
  expect(settings().rowHeight).toBe(512);
});

it("sets a 2D maximum row height that stays at least the minimum, turns off at 0 and hides in strip mode", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  const maximum = await control("Maximum row height in pixels", "Rows");
  const enter = async (value: string) => {
    await act(() => {
      maximum.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        maximum,
        value,
      );
      maximum.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key(maximum, "Enter");
    return settings().maxRowHeight;
  };
  expect(await enter("800")).toBe(800);
  expect(await enter("100")).toBe(300);
  expect(await enter("0")).toBe(0);
  expect(maximum.value).toBe("0");
  await click("Switch to strip layout");
  await control("Maximum row height in pixels", "Rows");
  expect(document.querySelector('[aria-label="Maximum row height in pixels"]')).toBeNull();
  await click("Switch to 2D layout");
  expect(await control("Maximum row height in pixels", "Rows")).not.toBeNull();
});

it("uses safe defaults for malformed saved preferences", async () => {
  await act(() => root.unmount());
  localStorage.setItem(
    "onirigiri-t3:workspace-preferences",
    '{"overviewZoom":"invalid","rowHeight":-20,"maxRowHeight":-5}',
  );
  root = createRoot(host);
  await act(() => root.render(<Workspace />));
  expect(settings()).toEqual({
    overviewZoom: "auto",
    rowHeight: "viewport",
    maxRowHeight: 1200,
    columnWidth: 840,
    maxColumnWidth: 1100,
    navigationBar: true,
    maximizeAll: false,
    showGrid: false,
    focusOnClick: false,
    showMinimap: true,
  });
});

it("shows the navigation bar by default and toggles it from the hover bar", async () => {
  expect(settings().navigationBar).toBe(true);
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await click("Hide navigation bar");
  expect(settings().navigationBar).toBe(false);
  expect(button("Show navigation bar").getAttribute("aria-pressed")).toBe("false");
  expect(
    JSON.parse(localStorage.getItem("onirigiri-t3:workspace-preferences")!).navigationBar,
  ).toBe(false);
  await click("Show navigation bar");
  expect(settings().navigationBar).toBe(true);
  expect(button("Hide navigation bar").getAttribute("aria-pressed")).toBe("true");
});

it("hides the grid by default and toggles it and focus on click from the hover bar", async () => {
  expect(settings().showGrid).toBe(false);
  await click("Workspace controls");
  await click("Show grid");
  expect(settings().showGrid).toBe(true);
  expect(button("Hide grid").getAttribute("aria-pressed")).toBe("true");
  await click("Advanced workspace controls");
  await click("Focus pane on click");
  expect(settings().focusOnClick).toBe(true);
  expect(button("Keep focus on click").getAttribute("aria-pressed")).toBe("true");
  expect(JSON.parse(localStorage.getItem("onirigiri-t3:workspace-preferences")!)).toMatchObject({
    showGrid: true,
    focusOnClick: true,
  });
  await click("Hide grid");
  await click("Keep focus on click");
  expect(settings()).toMatchObject({ showGrid: false, focusOnClick: false });
});

it("sets every column's width from 442 pixels up to half the view width, and double-click resets both sliders", async () => {
  expect(settings().columnWidth).toBe(840);
  await click("Workspace controls");
  await click("Advanced workspace controls");
  const slider = await control("Column width in pixels", "Columns");
  expect([slider.min, slider.max, slider.value]).toEqual(["442", "900", "840"]);
  await act(() => {
    slider.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "700");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(settings().columnWidth).toBe(700);
  expect(JSON.parse(localStorage.getItem("onirigiri-t3:workspace-preferences")!).columnWidth).toBe(
    700,
  );
  await act(() => slider.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(settings().columnWidth).toBe(840);
  await typeHeight("300");
  expect(settings().rowHeight).toBe(300);
  await act(() => rowHeight().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(settings().rowHeight).toBe("viewport");
});

it("shows the minimap by default and toggles it from an icon button", async () => {
  expect(settings().showMinimap).toBe(true);
  await click("Workspace controls");
  expect(button("Minimap").getAttribute("aria-pressed")).toBe("true");
  await click("Minimap");
  expect(settings().showMinimap).toBe(false);
  expect(button("Minimap").getAttribute("aria-pressed")).toBe("false");
  expect(JSON.parse(localStorage.getItem("onirigiri-t3:workspace-preferences")!).showMinimap).toBe(
    false,
  );
  await click("Minimap");
  expect(settings().showMinimap).toBe(true);
});

it("maximizes all panes edge to edge through the preference", async () => {
  await click("Workspace controls");
  await click("Full screen panes");
  expect(settings().maximizeAll).toBe(true);
  expect(button("Full screen panes").getAttribute("aria-pressed")).toBe("true");
  await click("Full screen panes");
  expect(settings().maximizeAll).toBe(false);
  expect(button("Full screen panes").getAttribute("aria-pressed")).toBe("false");
});

it("switches between the strip and 2D layouts", async () => {
  const mode = () => host.querySelector("[data-layout-mode]")!.getAttribute("data-layout-mode");
  expect(mode()).toBe("rows");
  await click("Workspace controls");
  await click("Switch to strip layout");
  expect(mode()).toBe("strip");
  await click("Switch to 2D layout");
  expect(mode()).toBe("rows");
});

it("switches pane pictures off for the next load and reloads", async () => {
  const reload = vi.fn();
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  expect(button("Pane pictures").getAttribute("aria-pressed")).toBe("true");
  await click("Pane pictures");
  expect(localStorage.getItem("onirigiri-t3:pane-pictures")).toBe("off");
  expect(reload).toHaveBeenCalledOnce();
  await act(() => root.unmount());
  root = createRoot(host);
  await act(() => root.render(<Workspace />));
  await click("Workspace controls");
  await click("Advanced workspace controls");
  expect(button("Pane pictures").getAttribute("aria-pressed")).toBe("false");
});
