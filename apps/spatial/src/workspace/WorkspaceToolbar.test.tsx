// @vitest-environment jsdom
import { act, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { useWorkspacePreferences } from "./useWorkspacePreferences";

let host: HTMLDivElement;
let root: Root;

function Workspace() {
  const [preferences, update] = useWorkspacePreferences();
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <WorkspaceToolbar
        focusAnchor="center"
        onAdd={() => {}}
        onToggleAnchor={() => {}}
        controlsRef={setControls}
        shortcuts={{}}
        preferences={preferences}
        onPreferencesChange={update}
        onResizePanes={() => {}}
      />
      {controls && createPortal(<button>Overview</button>, controls)}
      <output>{JSON.stringify(preferences)}</output>
      <button>Outside</button>
    </>
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

async function typeHeight(value: string) {
  await act(() => {
    const input = rowHeight();
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
  vi.unstubAllGlobals();
});

it("remembers overview and row defaults across reloads, with a way back to viewport height", async () => {
  expect(settings()).toEqual({ overviewZoom: "auto", rowHeight: "viewport" });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await act(() => {
    const select = host.querySelector("select")!;
    select.value = "near";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await typeHeight("384");
  await key(rowHeight(), "Enter");
  expect(settings()).toEqual({ overviewZoom: "near", rowHeight: 384 });

  await act(() => root.unmount());
  root = createRoot(host);
  await act(() => root.render(<Workspace />));
  expect(settings()).toEqual({ overviewZoom: "near", rowHeight: 384 });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("");
  await act(() => button("Advanced workspace controls").focus());
  expect(settings()).toEqual({ overviewZoom: "near", rowHeight: "viewport" });
});

it("discards invalid heights and Escape cancels a draft before restoring focus", async () => {
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("48");
  await key(rowHeight(), "Enter");
  expect(settings().rowHeight).toBe("viewport");
  expect(rowHeight().value).toBe("");
  await typeHeight("420");
  expect((await key(rowHeight(), "Escape")).defaultPrevented).toBe(true);
  expect(settings().rowHeight).toBe("viewport");
  expect(rowHeight().value).toBe("");
  expect(document.activeElement).toBe(button("Advanced workspace controls"));
  expect(button("Advanced workspace controls").getAttribute("aria-expanded")).toBe("false");
  await key(button("Advanced workspace controls"), "Escape");
  expect(document.activeElement).toBe(button("Workspace controls"));
});

it("handles Escape from portalled controls and closes when focus leaves", async () => {
  await click("Workspace controls");
  await act(() => button("Overview").focus());
  expect((await key(button("Overview"), "Escape")).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(button("Workspace controls"));
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await act(() => button("Outside").focus());
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
  await click("Workspace controls");
  expect(button("Advanced workspace controls").getAttribute("aria-expanded")).toBe("false");
});

it("opens on mouse hover while touch opens by click and outside press dismisses", async () => {
  const container = host.querySelector<HTMLElement>("[data-spatial-workspace-controls]")!;
  const enter = (pointerType: string) => {
    const event = new Event("pointerenter");
    Object.defineProperty(event, "pointerType", { value: pointerType });
    container.dispatchEvent(event);
  };
  await act(() => enter("touch"));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
  await click("Workspace controls");
  await act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
  await act(() => button("Outside").focus());
  await act(() => enter("mouse"));
  expect(button("Hide workspace controls").getAttribute("aria-expanded")).toBe("true");
  await act(() => container.dispatchEvent(new Event("pointerleave")));
  expect(button("Workspace controls").getAttribute("aria-expanded")).toBe("false");
});

it("keeps settings usable when storage cannot be written", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  await click("Workspace controls");
  await click("Advanced workspace controls");
  await typeHeight("512");
  await key(rowHeight(), "Enter");
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
  expect(settings()).toEqual({ overviewZoom: "auto", rowHeight: "viewport" });
});
