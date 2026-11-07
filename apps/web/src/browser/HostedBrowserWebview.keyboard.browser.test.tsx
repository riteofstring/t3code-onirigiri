import {
  EnvironmentId,
  FILL_PREVIEW_VIEWPORT,
  ThreadId,
  type DesktopPreviewHostKey,
} from "@t3tools/contracts";
import { DESKTOP_PREVIEW_HOST_KEY_CHANNEL } from "@t3tools/shared/previewHostKeyboard";
import { Profiler } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal } from "../../test/render";
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
  withDesktopTab: () => undefined,
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

function setup() {
  const stack = new DisposableStack();
  // Projection writes must land synchronously; the guest geometry never waits for a frame here.
  stack.use(stubGlobal("requestAnimationFrame", () => 0));
  stack.use(stubGlobal("cancelAnimationFrame", () => undefined));
  const send = vi.fn().mockResolvedValue(undefined);
  Object.defineProperties(HTMLElement.prototype, {
    getWebContentsId: { configurable: true, value: () => 41 },
    send: { configurable: true, value: send },
  });
  stack.defer(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "getWebContentsId");
    Reflect.deleteProperty(HTMLElement.prototype, "send");
  });
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  const lease = acquireBrowserSurface("guest", false);
  stack.defer(() => lease.release());
  const received: KeyboardEvent[] = [];
  const committed = vi.fn();
  const projection: BrowserSurfaceProjection = {
    width: 800,
    height: 600,
    scaleX: 1,
    scaleY: 1,
    clipPath: "inset(0)",
    interactive: true,
    onFocus: () => undefined,
    keyboard: { shortcuts: [shortcut], keyDown: (event) => received.push(event) },
  };
  const present = (value: BrowserSurfaceProjection | null = projection, visible = true) =>
    lease.present({ x: 0, y: 0, width: 800, height: 600 }, visible, 0, 30, value);
  present();
  const ui = (
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
    </Profiler>
  );
  return {
    ui,
    lease,
    send,
    received,
    committed,
    projection,
    present,
    [Symbol.dispose]: () => stack.dispose(),
  };
}

function guestOf(container: HTMLElement) {
  const guest = container.querySelector<HTMLElement>("webview")!;
  guest.tabIndex = 0;
  guest.focus();
  const message = (payload: unknown = input, channel = DESKTOP_PREVIEW_HOST_KEY_CHANNEL) =>
    act(() =>
      guest.dispatchEvent(Object.assign(new Event("ipc-message"), { channel, args: [payload] })),
    );
  return { guest, message };
}

it("revalidates payload, editing permission, focus and current visibility before host dispatch", async () => {
  using f = setup();
  // The guest has no links; nothing here navigates.
  await using screen = await render(f.ui, { router: false });
  const { guest, message } = guestOf(screen.container);
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
  expect(f.received).toHaveLength(0);
  guest.blur();
  await message();
  guest.focus();
  await act(() => f.present(f.projection, false));
  await message();
  await act(() => f.present({ ...f.projection, interactive: false }));
  await message();
  expect(f.received).toHaveLength(0);
  await act(() => f.present());
  // Hiding the guest drops its DOM focus in a real browser, so focus it again as a click would.
  guest.focus();
  await message();
  expect(f.received).toHaveLength(1);
});

it("moves and clips the retained guest without a React commit or logical viewport change", async () => {
  using f = setup();
  // The guest has no links; nothing here navigates.
  await using screen = await render(f.ui, { router: false });
  const { guest, message } = guestOf(screen.container);
  const wrapper = screen.container.querySelector<HTMLDivElement>("[data-preview-viewport]")!;
  const guestStyle = guest.getAttribute("style");
  const keyboardCalls = f.send.mock.calls.length;
  f.committed.mockClear();
  for (const [x, y, scale, clipPath] of [
    [100.25, 80, 1, "inset(0px)"],
    [240, 120, 0.5, 'path("M 40 20 H 760 V 580 H 40 Z")'],
    [-1200, 90, 0.75, "inset(50%)"],
  ] as const) {
    await act(() =>
      f.lease.present({ x, y, width: 800 * scale, height: 600 * scale }, true, 12, 42, {
        ...f.projection,
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
    expect(screen.container.querySelector("webview")).toBe(guest);
    expect(guest.getAttribute("style")).toBe(guestStyle);
  }
  expect(f.committed).not.toHaveBeenCalled();
  expect(f.send).toHaveBeenCalledTimes(keyboardCalls);
  await message();
  expect(f.received).toHaveLength(1);
});
