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
import { act } from "react";
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

function present(value: BrowserSurfaceProjection | null = projection, visible = true) {
  lease.present({ x: 0, y: 0, width: 800, height: 600 }, visible, 0, 30, value);
}

async function mount(projected = true) {
  if (projected) present();
  else present(null);
  await act(() => {
    root.render(
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
      />,
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
