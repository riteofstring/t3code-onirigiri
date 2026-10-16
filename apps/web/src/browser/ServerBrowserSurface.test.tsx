// @vitest-environment jsdom
import type {
  createPreviewStreamClient,
  PreviewStreamEvents,
  PreviewStreamInput,
} from "@t3tools/client-runtime/preview/server-browser-stream";
import { EnvironmentId } from "@t3tools/contracts";
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  connect: vi.fn<typeof createPreviewStreamClient>(),
  send: vi.fn<(input: PreviewStreamInput) => boolean>(() => true),
  stop: vi.fn(),
  resize: null as ((entries: readonly ResizeObserverEntry[]) => void) | null,
  access: {
    httpBase: "https://example.com",
    wsBase: "wss://example.com",
    query: {},
    credentials: true,
  },
}));

vi.mock("@t3tools/client-runtime/preview/server-browser-stream", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@t3tools/client-runtime/preview/server-browser-stream")
  >()),
  createPreviewStreamClient: mocks.connect,
  createPreviewFramePainter: (_canvas: HTMLCanvasElement, firstFrame: () => void) => ({
    paint: firstFrame,
    stop: () => undefined,
  }),
}));
vi.mock("~/state/previewStream", () => ({ usePreviewStreamAccess: () => mocks.access }));
vi.mock("~/lib/observeResize", () => ({
  observeResize: (
    _element: Element,
    callback: (entries: readonly ResizeObserverEntry[]) => void,
  ) => {
    mocks.resize = callback;
    return () => {
      mocks.resize = null;
    };
  },
}));
vi.mock("~/components/CommandBlock", () => ({ CommandBlock: () => null }));
vi.mock("~/components/preview/AgentBrowserCursor", () => ({ AgentCursorMark: () => null }));
vi.mock("~/components/ui/button", () => ({
  Button: ({ children }: PropsWithChildren) => <button>{children}</button>,
}));
vi.mock("~/components/ui/input", () => ({ Input: () => <input /> }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn(), close: vi.fn() } }));

import {
  BrowserSurfaceProjectionContext,
  type BrowserSurfaceProjectionPolicy,
} from "./browserSurfaceProjection";
import { ServerBrowserSurface } from "./ServerBrowserSurface";

let root: Root;
let host: HTMLDivElement;
let callbacks: PreviewStreamEvents;
let policy: BrowserSurfaceProjectionPolicy;
let keys: KeyboardEvent[];

function view(visible = true) {
  return (
    <BrowserSurfaceProjectionContext value={policy}>
      <ServerBrowserSurface
        environmentId={EnvironmentId.make("remote")}
        threadId="thread"
        tabId="tab"
        visible={visible}
      />
    </BrowserSurfaceProjectionContext>
  );
}

async function resize(width: number, height: number, delay: number) {
  await act(() => {
    mocks.resize?.([{ contentRect: new DOMRect(0, 0, width, height) } as ResizeObserverEntry]);
  });
  await act(() => vi.advanceTimersByTimeAsync(delay));
}

async function mount() {
  await act(() => root.render(view()));
  await resize(1000, 600, 1);
  await act(() => {
    callbacks.onFrame(new ArrayBuffer(0));
    callbacks.onViewport({ width: 1000, height: 600 });
    callbacks.onControl?.({ canOperate: true, controller: "you", generation: 1, dialog: null });
  });
}

async function key(type: "keydown" | "keyup", input: KeyboardEventInit) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...input });
  await act(() => host.querySelector("textarea")!.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.send.mockClear();
  mocks.stop.mockClear();
  mocks.connect.mockReset().mockImplementation((_target, events) => {
    callbacks = events;
    return { send: mocks.send, stop: mocks.stop };
  });
  keys = [];
  policy = {
    canPresent: () => true,
    occluders: () => [],
    interactive: () => true,
    focus: () => undefined,
    keyboard: {
      shortcuts: [
        {
          key: "ArrowRight",
          altKey: true,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          whileEditing: true,
        },
        { key: "o", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
      ],
      keyDown: (_slot, event) => keys.push(event),
    },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the remote page in logical layout pixels while the camera scales its canvas", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 500, 300),
  );
  await mount();
  expect(mocks.send).toHaveBeenCalledWith({ type: "resize", width: 1000, height: 600 });
  const connected = mocks.connect.mock.calls.length;
  mocks.send.mockClear();
  host.style.transform = "scale(0.25)";
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.connect).toHaveBeenCalledTimes(connected);
  await resize(1100, 700, 150);
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ type: "resize", width: 1100, height: 700 });
});

it("routes reserved spatial chords without sending their press or release to the remote page", async () => {
  await mount();
  mocks.send.mockClear();
  const down = await key("keydown", { key: "ArrowRight", code: "ArrowRight", altKey: true });
  await key("keyup", { key: "ArrowRight", code: "ArrowRight", altKey: true });
  expect(down.defaultPrevented).toBe(true);
  expect(keys).toHaveLength(1);
  expect(keys[0]).toMatchObject({ key: "ArrowRight", altKey: true });
  expect(mocks.send).not.toHaveBeenCalled();
  await key("keydown", { key: "o", code: "KeyO" });
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "key", key: "o", text: "o" }),
  );
  expect(keys).toHaveLength(1);
});

it("keeps composition and an inert spatial surface out of host shortcut dispatch", async () => {
  await mount();
  mocks.send.mockClear();
  await key("keydown", { key: "ArrowRight", code: "ArrowRight", altKey: true, isComposing: true });
  expect(keys).toHaveLength(0);
  expect(mocks.send).not.toHaveBeenCalled();
  host.setAttribute("inert", "");
  await key("keydown", { key: "ArrowRight", code: "ArrowRight", altKey: true });
  expect(keys).toHaveLength(0);
  host.removeAttribute("inert");
  await act(() =>
    callbacks.onControl?.({
      canOperate: false,
      controller: "another-viewer",
      generation: 2,
      dialog: null,
    }),
  );
  mocks.send.mockClear();
  await key("keydown", { key: "a", code: "KeyA" });
  expect(mocks.send).not.toHaveBeenCalled();
  await act(() => root.render(view(false)));
  expect(mocks.stop).toHaveBeenCalledOnce();
});
