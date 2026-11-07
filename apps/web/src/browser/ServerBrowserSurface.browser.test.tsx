import { EnvironmentId } from "@t3tools/contracts";
import type {
  PreviewStreamControl,
  PreviewStreamEvents,
  PreviewStreamInput,
} from "@t3tools/client-runtime/preview/server-browser-stream";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn<(target: unknown, handlers: PreviewStreamEvents) => unknown>(),
  sent: [] as PreviewStreamInput[],
  access: { url: "ws://preview.test", token: "test" },
  painted: null as (() => void) | null,
  stops: 0,
}));

vi.mock(import("@t3tools/client-runtime/preview/server-browser-stream"), async (original) => ({
  ...(await original()),
  createPreviewStreamClient: mocks.createClient as never,
  createPreviewFramePainter: (_canvas, onPainted) => {
    mocks.painted = onPainted ?? null;
    return { paint: () => undefined, stop: () => undefined };
  },
}));

vi.mock(import("~/state/previewStream"), async (original) => ({
  ...(await original()),
  usePreviewStreamAccess: () => mocks.access as never,
}));

import {
  BrowserSurfaceProjectionContext,
  type BrowserSurfaceProjectionPolicy,
} from "./browserSurfaceProjection";
import { ServerBrowserSurface } from "./ServerBrowserSurface";

function setup() {
  mocks.sent.length = 0;
  mocks.painted = null;
  mocks.stops = 0;
  mocks.createClient.mockReset().mockImplementation(() => ({
    send: (input: PreviewStreamInput) => mocks.sent.push(input),
    stop: () => {
      mocks.stops += 1;
    },
  }));
}

function surface(visible = true) {
  return (
    <ServerBrowserSurface
      environmentId={EnvironmentId.make("environment-copy")}
      threadId="thread-copy"
      tabId="tab-copy"
      visible={visible}
      followSize={false}
      className="flex-1"
    />
  );
}

async function renderSurface(
  controller: PreviewStreamControl["controller"],
  ui: (child: ReturnType<typeof surface>) => ReturnType<typeof surface> = (child) => child,
) {
  const container = document.createElement("div");
  container.style.cssText = "width: 400px; height: 300px; display: flex;";
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await render(ui(surface()), { container }));
  await vi.waitFor(() => expect(mocks.createClient).toHaveBeenCalled());
  const handlers = mocks.createClient.mock.calls.at(-1)![1];
  await act(() =>
    handlers.onControl?.({ canOperate: true, controller, generation: 1, dialog: null }),
  );
  mocks.sent.length = 0;
  const input = container.querySelector("textarea")!;
  const canvas = container.querySelector("canvas")!;
  stack.move();
  return { screen, container, input, canvas, handlers };
}

const keys = () => mocks.sent.filter((input) => input.type === "key");

describe("ServerBrowserSurface clipboard commands", () => {
  it("sends a native Copy or Cut menu command to the page once", async () => {
    setup();
    const { screen, input, canvas } = await renderSurface("you");
    await using _screen = screen;
    // Chromium runs a script Copy or Cut only during a user gesture, as a menu click is.
    await userEvent.click(canvas);
    input.focus();
    mocks.sent.length = 0;

    // Like Electron's webContents.copy(): the browser's Copy command, with no key.
    expect(document.execCommand("copy")).toBe(true);
    expect(keys()).toEqual([
      { type: "key", action: "down", key: "c", code: "KeyC", keyCode: 67, modifiers: 2 },
      { type: "key", action: "up", key: "c", code: "KeyC", keyCode: 67, modifiers: 2 },
    ]);

    mocks.sent.length = 0;
    expect(document.execCommand("cut")).toBe(true);
    expect(input.value).toBe("\u200b");
    expect(keys()).toEqual([
      { type: "key", action: "down", key: "x", code: "KeyX", keyCode: 88, modifiers: 2 },
      { type: "key", action: "up", key: "x", code: "KeyX", keyCode: 88, modifiers: 2 },
    ]);
  });

  it("sends a keyboard Copy or Cut once and leaves menu Copy working after any shortcut", async () => {
    setup();
    const { screen, input, canvas } = await renderSurface("you");
    await using _screen = screen;
    await userEvent.click(canvas);
    input.focus();
    const prevented: boolean[] = [];
    const onKeyDown = (event: KeyboardEvent) => {
      if (/^[cx]$/i.test(event.key)) prevented.push(event.defaultPrevented);
    };
    window.addEventListener("keydown", onKeyDown);
    using _listener = { [Symbol.dispose]: () => window.removeEventListener("keydown", onKeyDown) };

    // An unprevented copy or cut key also makes the browser fire copy or cut: here Chromium's
    // Ctrl key binding, on macOS Electron's menu after the Meta keyup.
    for (const [shortcut, cancels] of [
      ["{Control>}x{/Control}", true],
      ["{Control>}c{/Control}", true],
      ["{Meta>}{x>}{/Meta}{/x}", true],
      ["{Control>}{Shift>}c{/Shift}{/Control}", false],
      ["{Control>}{Alt>}x{/Alt}{/Control}", false],
    ] as const) {
      mocks.sent.length = 0;
      prevented.length = 0;
      await userEvent.keyboard(shortcut);
      expect(prevented, shortcut).toEqual([cancels]);
      expect(keys().filter((key) => /^[cx]$/i.test(key.key)).length, shortcut).toBe(2);
      expect(input.value).toBe("\u200b");

      mocks.sent.length = 0;
      expect(document.execCommand("copy")).toBe(true);
      expect(keys(), shortcut).toEqual([
        { type: "key", action: "down", key: "c", code: "KeyC", keyCode: 67, modifiers: 2 },
        { type: "key", action: "up", key: "c", code: "KeyC", keyCode: 67, modifiers: 2 },
      ]);
    }
  });

  it("sends nothing when another viewer controls the page", async () => {
    setup();
    const { screen, input } = await renderSurface("another-viewer");
    await using _screen = screen;

    expect(
      input.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true })),
    ).toBe(false);
    expect(
      input.dispatchEvent(new ClipboardEvent("cut", { bubbles: true, cancelable: true })),
    ).toBe(false);
    expect(mocks.sent).toEqual([]);
  });
});

const mouseUp = (canvas: HTMLCanvasElement, button: number) => {
  const event = new MouseEvent("mouseup", { button, bubbles: true, cancelable: true });
  canvas.dispatchEvent(event);
  return event;
};

describe("ServerBrowserSurface history", () => {
  it("routes mouse thumb buttons to the preview's history instead of the app", async () => {
    setup();
    const { screen, input } = await renderSurface("you");
    await using _screen = screen;
    const canvas = input.closest("[data-server-browser-surface]")!.querySelector("canvas")!;

    expect(mouseUp(canvas, 3).defaultPrevented).toBe(true);
    expect(mouseUp(canvas, 4).defaultPrevented).toBe(true);
    expect(mocks.sent).toEqual([
      { type: "history", delta: -1 },
      { type: "history", delta: 1 },
    ]);
  });

  it("leaves other mouse buttons alone", async () => {
    setup();
    const { screen, input } = await renderSurface("you");
    await using _screen = screen;
    const canvas = input.closest("[data-server-browser-surface]")!.querySelector("canvas")!;

    expect(mouseUp(canvas, 0).defaultPrevented).toBe(false);
    expect(mocks.sent).toEqual([]);
  });

  it("does not forward thumb-button presses to the page", async () => {
    setup();
    const { screen, input } = await renderSurface("you");
    await using _screen = screen;
    const canvas = input.closest("[data-server-browser-surface]")!.querySelector("canvas")!;
    canvas.width = 400;
    canvas.height = 300;
    // Synthetic pointers have no active pointer id to capture.
    canvas.setPointerCapture = () => undefined;
    const handlers = mocks.createClient.mock.calls.at(-1)![1];
    await act(() => {
      mocks.painted?.();
      handlers.onViewport({ width: 400, height: 300 });
    });
    const { left, top } = canvas.getBoundingClientRect();
    const press = (type: "pointerdown" | "pointerup", button: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          button,
          buttons: type === "pointerdown" ? 1 << button : 0,
          clientX: left + 10,
          clientY: top + 10,
          pointerType: "mouse",
          bubbles: true,
        }),
      );
    const mouseInputs = () => mocks.sent.filter((input) => input.type === "mouse");

    for (const button of [3, 4]) {
      press("pointerdown", button);
      press("pointerup", button);
    }
    expect(mouseInputs()).toEqual([]);

    press("pointerdown", 0);
    expect(mouseInputs()).not.toEqual([]);
  });
});

function spatialPolicy() {
  const routed: KeyboardEvent[] = [];
  const policy: BrowserSurfaceProjectionPolicy = {
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
      keyDown: (_slot, event) => routed.push(event),
    },
  };
  const wrap = (child: ReturnType<typeof surface>) => (
    <BrowserSurfaceProjectionContext value={policy}>{child}</BrowserSurfaceProjectionContext>
  );
  return { routed, wrap };
}

const press = (input: HTMLTextAreaElement, type: "keydown" | "keyup", init: KeyboardEventInit) => {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  return event;
};

describe("ServerBrowserSurface spatial shortcuts", () => {
  it("routes reserved spatial chords without sending their press or release to the remote page", async () => {
    setup();
    const { routed, wrap } = spatialPolicy();
    const { screen, input } = await renderSurface("you", wrap);
    await using _screen = screen;

    const down = press(input, "keydown", { key: "ArrowRight", code: "ArrowRight", altKey: true });
    press(input, "keyup", { key: "ArrowRight", code: "ArrowRight", altKey: true });
    expect(down.defaultPrevented).toBe(true);
    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({ key: "ArrowRight", altKey: true });
    expect(keys()).toEqual([]);

    press(input, "keydown", { key: "o", code: "KeyO" });
    expect(keys()).toContainEqual(expect.objectContaining({ type: "key", key: "o", text: "o" }));
    expect(routed).toHaveLength(1);
  });

  it("keeps composition and an inert spatial surface out of host shortcut dispatch", async () => {
    setup();
    const { routed, wrap } = spatialPolicy();
    const { screen, container, input, handlers } = await renderSurface("you", wrap);
    await using _screen = screen;

    press(input, "keydown", {
      key: "ArrowRight",
      code: "ArrowRight",
      altKey: true,
      isComposing: true,
    });
    expect(routed).toHaveLength(0);
    expect(keys()).toEqual([]);

    container.setAttribute("inert", "");
    press(input, "keydown", { key: "ArrowRight", code: "ArrowRight", altKey: true });
    expect(routed).toHaveLength(0);
    container.removeAttribute("inert");

    await act(() =>
      handlers.onControl?.({
        canOperate: false,
        controller: "another-viewer",
        generation: 2,
        dialog: null,
      }),
    );
    mocks.sent.length = 0;
    press(input, "keydown", { key: "a", code: "KeyA" });
    expect(keys()).toEqual([]);

    await screen.rerender(wrap(surface(false)));
    expect(mocks.stops).toBe(1);
  });
});
