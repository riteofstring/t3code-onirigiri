// @vitest-environment jsdom
import {
  EnvironmentId,
  FILL_PREVIEW_VIEWPORT,
  ThreadId,
  type DesktopPreviewHostKey,
} from "@t3tools/contracts";
import {
  DESKTOP_PREVIEW_HOST_KEY_CHANNEL,
  DESKTOP_PREVIEW_HOST_SHORTCUTS_CHANNEL,
} from "@t3tools/shared/previewHostKeyboard";
import { act, Profiler, type ProfilerOnRenderCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { acquireBrowserSurface, useBrowserSurfaceStore } from "./browserSurfaceStore";
import type { BrowserSurfaceProjection } from "./browserSurfaceProjection";

vi.mock("~/hooks/useSettings", () => ({ useClientSettingsHydrated: () => true }));
vi.mock("~/components/preview/previewBridge", () => ({
  previewBridge: { registerWebview: async () => undefined },
}));
vi.mock("~/components/preview/usePreviewBridge", () => ({ usePreviewBridge: () => undefined }));
vi.mock("./previewWebviewConfigState", () => ({
  usePreviewWebviewConfig: () => ({ partition: "test", webPreferences: "", preloadUrl: null }),
}));
vi.mock("./desktopTabLifetime", () => ({
  acquireDesktopTab: () => ({ ready: Promise.resolve(), release: () => undefined }),
}));
vi.mock("./browserRecording", () => ({ useActiveBrowserRecordingTabIds: () => new Set() }));

const shortcut = {
  key: "ArrowRight",
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};
const input: DesktopPreviewHostKey = {
  ...shortcut,
  code: "ArrowRight",
  repeat: false,
  isComposing: false,
  keyCode: 39,
  altGraph: false,
  editing: false,
};
let root: Root;
let host: HTMLDivElement;
let guest: HTMLElement;
let lease: ReturnType<typeof acquireBrowserSurface>;
let projection: BrowserSurfaceProjection;
let received: KeyboardEvent[];
let send: ReturnType<typeof vi.fn>;
let committed: ReturnType<typeof vi.fn<ProfilerOnRenderCallback>>;

function present(value: BrowserSurfaceProjection | null = projection, visible = true) {
  lease.present({ x: 0, y: 0, width: 800, height: 600 }, visible, 0, 30, value);
}

async function mount(projected = true) {
  if (projected) present();
  else present(null);
  await act(() => {
    root.render(
      <Profiler id="guest" onRender={committed}>
        <HostedBrowserWebview
          threadRef={{
            environmentId: EnvironmentId.make("keyboard"),
            threadId: ThreadId.make("thread"),
          }}
          tabId="tab"
          runtimeTabId="guest"
          initialUrl="https://example.com"
          viewport={FILL_PREVIEW_VIEWPORT}
          pictureInPicture={false}
          profileId={undefined}
          zoomFactor={1}
        />
      </Profiler>,
    );
  });
  guest = host.querySelector("webview")!;
  guest.tabIndex = 0;
  guest.focus();
}

async function message(payload: unknown = input, channel = DESKTOP_PREVIEW_HOST_KEY_CHANNEL) {
  await act(() =>
    guest.dispatchEvent(Object.assign(new Event("ipc-message"), { channel, args: [payload] })),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("PointerEvent", MouseEvent);
  send = vi.fn().mockResolvedValue(undefined);
  committed = vi.fn();
  Object.defineProperties(HTMLElement.prototype, {
    getWebContentsId: { configurable: true, value: () => 41 },
    send: { configurable: true, value: send },
    scrollTo: { configurable: true, value: () => undefined },
  });
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  lease = acquireBrowserSurface("guest", false);
  received = [];
  projection = {
    width: 800,
    height: 600,
    scaleX: 1,
    scaleY: 1,
    clipPath: "inset(0)",
    interactive: true,
    onFocus: () => undefined,
    keyboard: { shortcuts: [shortcut], keyDown: (event) => received.push(event) },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  lease.release();
  host.remove();
  Reflect.deleteProperty(HTMLElement.prototype, "getWebContentsId");
  Reflect.deleteProperty(HTMLElement.prototype, "send");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opts only a projected Browser into its configured chords and restores them after navigation", async () => {
  await mount(false);
  expect(send).not.toHaveBeenCalled();
  await message();
  expect(received).toHaveLength(0);
  await act(() => present());
  expect(send).toHaveBeenLastCalledWith(DESKTOP_PREVIEW_HOST_SHORTCUTS_CHANNEL, [shortcut]);
  send.mockClear();
  await act(() => guest.dispatchEvent(new Event("dom-ready")));
  expect(send).toHaveBeenCalledWith(DESKTOP_PREVIEW_HOST_SHORTCUTS_CHANNEL, [shortcut]);
  await message({ ...input, repeat: true });
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({
    key: "ArrowRight",
    altKey: true,
    repeat: true,
    cancelable: true,
  });
  await act(() => present(null));
  expect(send).toHaveBeenLastCalledWith(DESKTOP_PREVIEW_HOST_SHORTCUTS_CHANNEL, []);
  await message();
  expect(received).toHaveLength(1);
});

it("revalidates payload, editing permission, focus and current visibility before host dispatch", async () => {
  await mount();
  for (const payload of [
    null,
    { ...input, altKey: "true" },
    { ...input, key: "ArrowLeft" },
    { ...input, editing: true },
    { ...input, isComposing: true },
    { ...input, keyCode: 229 },
    { ...input, altGraph: true },
    { ...input, metaKey: true },
  ])
    await message(payload);
  await message(input, "unrelated");
  expect(received).toHaveLength(0);
  guest.blur();
  await message();
  guest.focus();
  await act(() => present(projection, false));
  await message();
  await act(() => present({ ...projection, interactive: false }));
  await message();
  expect(received).toHaveLength(0);
  await act(() => present());
  await message();
  expect(received).toHaveLength(1);
});

it("moves and clips the retained guest without a React commit or logical viewport change", async () => {
  await mount();
  const wrapper = host.querySelector<HTMLDivElement>("[data-preview-viewport]")!;
  const guestStyle = guest.getAttribute("style");
  const keyboardCalls = send.mock.calls.length;
  committed.mockClear();
  for (const [x, y, scale, clipPath] of [
    [100.25, 80, 1, "inset(0)"],
    [240, 120, 0.5, 'path("M40 20H760V580H40Z")'],
    [-1200, 90, 0.75, "inset(50%)"],
  ] as const) {
    await act(() =>
      lease.present({ x, y, width: 800 * scale, height: 600 * scale }, true, 12, 42, {
        ...projection,
        scaleX: scale,
        scaleY: scale,
        clipPath,
      }),
    );
    expect({
      left: wrapper.style.left,
      top: wrapper.style.top,
      width: wrapper.style.width,
      height: wrapper.style.height,
      transform: wrapper.style.transform,
      transformOrigin: wrapper.style.transformOrigin,
      clipPath: wrapper.style.clipPath,
      borderRadius: wrapper.style.borderRadius,
      zIndex: wrapper.style.zIndex,
    }).toEqual({
      left: "0px",
      top: "0px",
      width: "800px",
      height: "600px",
      transform: `translate3d(${x}px, ${y}px, 0px) scale(${scale}, ${scale})`,
      transformOrigin: "0px 0px",
      clipPath,
      borderRadius: "12px",
      zIndex: "42",
    });
    expect(host.querySelector("webview")).toBe(guest);
    expect(guest.getAttribute("style")).toBe(guestStyle);
  }
  expect(committed).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(keyboardCalls);
  await message();
  expect(received).toHaveLength(1);
});

it("clears projected geometry while hidden and restores the same guest after background capture", async () => {
  await mount();
  const wrapper = host.querySelector<HTMLDivElement>("[data-preview-viewport]")!;
  await act(() =>
    lease.present({ x: 140, y: 90, width: 400, height: 300 }, true, 12, 42, {
      ...projection,
      scaleX: 0.5,
      scaleY: 0.5,
      clipPath: "inset(0 40px 0 0)",
    }),
  );
  await act(() => present(projection, false));
  expect(wrapper.style.visibility).toBe("hidden");
  expect(wrapper.style.transform).toBe("");
  expect(wrapper.style.clipPath).toBe("");
  expect(wrapper.style.borderRadius).toBe("");
  expect(wrapper.style.pointerEvents).toBe("none");
  expect(wrapper.style.left).toBe("-100000px");
  expect(wrapper.hasAttribute("inert")).toBe(true);
  let release!: () => void;
  await act(() => {
    release = useBrowserSurfaceStore.getState().acquireActivity("guest");
  });
  expect(wrapper.style.visibility).toBe("visible");
  expect(wrapper.style.left).toBe("0px");
  expect(wrapper.style.top).toBe("0px");
  expect(wrapper.style.zIndex).toBe("-1");
  expect(wrapper.dataset.previewRendering).toBe("active");
  await act(() => release());
  expect(wrapper.style.visibility).toBe("hidden");
  await act(() => present());
  expect(wrapper.style.visibility).toBe("");
  expect(wrapper.style.transform).toBe("translate3d(0px, 0px, 0px) scale(1, 1)");
  expect(wrapper.style.pointerEvents).toBe("auto");
  expect(wrapper.hasAttribute("inert")).toBe(false);
  expect(host.querySelector("webview")).toBe(guest);
  await message();
  expect(received).toHaveLength(1);
});

it("updates logical size and input state while ignoring another tab's presentation", async () => {
  await mount();
  const wrapper = host.querySelector<HTMLDivElement>("[data-preview-viewport]")!;
  committed.mockClear();
  const other = acquireBrowserSurface("other");
  await act(() => other.present({ x: 30, y: 20, width: 200, height: 100 }, true));
  expect(committed).not.toHaveBeenCalled();
  await act(() =>
    lease.present({ x: 100, y: 80, width: 500, height: 350 }, true, 0, 30, {
      ...projection,
      width: 1000,
      height: 700,
      scaleX: 0.5,
      scaleY: 0.5,
      interactive: false,
    }),
  );
  expect(committed).toHaveBeenCalled();
  expect(wrapper.style.width).toBe("1000px");
  expect(wrapper.style.height).toBe("700px");
  expect(wrapper.style.pointerEvents).toBe("none");
  expect(wrapper.hasAttribute("inert")).toBe(true);
  expect(guest.style.width).toBe("1000px");
  expect(guest.style.height).toBe("700px");
  expect(host.querySelector("webview")).toBe(guest);
  await message();
  expect(received).toHaveLength(0);
  await act(() => present(null));
  expect(wrapper.style.transform).toBe("");
  expect(wrapper.style.clipPath).toBe("");
  expect(wrapper.style.width).toBe("800px");
  expect(wrapper.hasAttribute("inert")).toBe(false);
  other.release();
});
