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
  const [maximized, setMaximized] = useState(false);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  return (
    <WorkspaceTooltips>
      <WorkspaceToolbar
        focusAnchor="center"
        onAdd={() => {}}
        onToggleAnchor={() => {}}
        controlsRef={setControls}
        shortcuts={{}}
        preferences={preferences}
        maxRowHeight={maximum}
        onPreferencesChange={update}
        onResizePanes={(mode) => setMaximized(mode === "full")}
        panesMaximized={maximized}
      />
      {controls && createPortal(<button>Overview</button>, controls)}
      <output>{JSON.stringify(preferences)}</output>
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

function rowHeight() {
  return host.querySelector<HTMLInputElement>('input[aria-label="Default row height in pixels"]')!;
}

async function click(label: string) {
  await act(() => {
    const target = button(label);
    target.focus();
    target.click();
  });
}

async function typeHeight(value: string, commit = true) {
  await act(() => {
    const input = rowHeight();
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (commit) await act(() => rowHeight().dispatchEvent(new Event("pointerup", { bubbles: true })));
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

it("remembers overview and row defaults across reloads, with a way back to viewport height", async () => {
  expect(settings()).toEqual({ overviewZoom: "medium", rowHeight: "viewport", navigationBar: false });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await act(() => {
    const select = host.querySelector<HTMLButtonElement>('[aria-label="Overview zoom"]')!;
    select.focus();
    select.click();
  });
  await act(() => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (element) => element.textContent === "Near",
    )!;
    option.click();
  });
  await typeHeight("384");
  expect(settings()).toEqual({ overviewZoom: "near", rowHeight: 384, navigationBar: false });

  await act(() => root.unmount());
  root = createRoot(host);
  await act(() => root.render(<Workspace />));
  expect(settings()).toEqual({ overviewZoom: "near", rowHeight: 384, navigationBar: false });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("880");
  expect(settings()).toEqual({ overviewZoom: "near", rowHeight: "viewport", navigationBar: false });
});

it("keeps drag previews local and applies only the final pane height", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("300", false);
  await typeHeight("420", false);
  expect(rowHeight().value).toBe("420");
  expect(settings().rowHeight).toBe("viewport");
  await act(() => rowHeight().dispatchEvent(new Event("pointerup", { bubbles: true })));
  expect(settings().rowHeight).toBe(420);
  await typeHeight("500", false);
  await act(() => rowHeight().blur());
  expect(settings().rowHeight).toBe(500);
});

it("bounds the slider to the view while preserving fixed heights across resizing", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("720");
  expect(settings().rowHeight).toBe(720);
  await click("Shorter view");
  expect(rowHeight().max).toBe("640");
  expect(rowHeight().value).toBe("640");
  expect(settings().rowHeight).toBe(720);
  await click("Taller view");
  expect(rowHeight().value).toBe("720");
  await typeHeight("1000");
  expect(settings().rowHeight).toBe("viewport");
  await click("Shorter view");
  expect(rowHeight().value).toBe("640");
  await click("Tiny view");
  expect(rowHeight().min).toBe("60");
  expect(rowHeight().max).toBe("60");
  expect(rowHeight().disabled).toBe(true);
});

it("Escape closes Advanced and restores focus without undoing an applied height", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("420");
  expect((await key(rowHeight(), "Escape")).defaultPrevented).toBe(true);
  expect(settings().rowHeight).toBe(420);
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

it("uses safe defaults for malformed saved preferences", async () => {
  await act(() => root.unmount());
  localStorage.setItem(
    "onirigiri-t3:workspace-preferences",
    '{"overviewZoom":"invalid","rowHeight":-20}',
  );
  root = createRoot(host);
  await act(() => root.render(<Workspace />));
  expect(settings()).toEqual({ overviewZoom: "medium", rowHeight: "viewport", navigationBar: false });
});

it("toggles the navigation bar preference from the hover bar", async () => {
  expect(settings().navigationBar).toBe(false);
  await click("Workspace controls");
  await click("Show navigation bar");
  expect(settings().navigationBar).toBe(true);
  expect(button("Hide navigation bar").getAttribute("aria-pressed")).toBe("true");
  expect(JSON.parse(localStorage.getItem("onirigiri-t3:workspace-preferences")!).navigationBar).toBe(
    true,
  );
  await click("Hide navigation bar");
  expect(settings().navigationBar).toBe(false);
  expect(button("Show navigation bar").getAttribute("aria-pressed")).toBe("false");
});
