import * as NodeEvents from "node:events";
import type { BrowserWindow, BrowserWindowConstructorOptions, WebFrameMain } from "electron";
import * as Effect from "effect/Effect";
import { it as effectIt } from "@effect/vitest";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const boundary = vi.hoisted(() => ({
  ports: [] as { close: ReturnType<typeof vi.fn> }[],
  session: {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
  },
}));
vi.mock("electron", () => ({
  session: { fromPartition: vi.fn(() => boundary.session) },
  MessageChannelMain: class {
    port1 = { close: vi.fn() };
    port2 = { close: vi.fn() };
    constructor() {
      boundary.ports.push(this.port1, this.port2);
    }
  },
}));

import { createPanePictureRaster } from "./PanePictureRaster.ts";
import * as Protocol from "./PanePictureProtocol.ts";
import * as DesktopPanePictureRaster from "./DesktopPanePictureRaster.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";

class Window extends NodeEvents.EventEmitter {
  destroyed = false;
  loading: Promise<void> = Promise.resolve();
  webContents = Object.assign(new NodeEvents.EventEmitter(), {
    id: 0,
    mainFrame: { detached: false } as WebFrameMain,
    getOSProcessId: () => this.webContents.id + 100,
    isDestroyed: () => this.destroyed,
    send: vi.fn(),
    postMessage: vi.fn(),
    setZoomFactor: vi.fn(),
    enableDeviceEmulation: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  });
  constructor(id: number) {
    super();
    this.webContents.id = id;
  }
  loadURL = vi.fn(() => this.loading);
  isDestroyed = () => this.destroyed;
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.webContents.emit("destroyed");
    this.emit("closed");
  });
}

function fixture() {
  const owner = new Window(1);
  const helpers: Window[] = [];
  const create = vi.fn(async (_options: BrowserWindowConstructorOptions) => {
    const helper = new Window(helpers.length + 2);
    helpers.push(helper);
    return helper as unknown as BrowserWindow;
  });
  const service = createPanePictureRaster(
    owner as unknown as BrowserWindow,
    create,
    "/preload.cjs",
  );
  return { owner, helpers, create, service };
}

beforeEach(() => {
  boundary.ports.length = 0;
  vi.clearAllMocks();
});

effectIt.effect(
  "admits only the tracked main renderer and releases its helper with the service scope",
  () =>
    Effect.gen(function* () {
      const owner = new Window(1);
      const helper = new Window(2);
      const create = vi.fn(() => Effect.succeed(helper as unknown as BrowserWindow));
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* DesktopPanePictureRaster.make;
          expect(yield* service.connect({ sender: { id: 99 } }, "guest")).toBe(false);
          expect(yield* service.connect({ sender: { id: 1 }, senderFrame: null }, "stale")).toBe(
            false,
          );
          expect(create).not.toHaveBeenCalled();
          expect(
            yield* service.connect(
              { sender: { id: 1 }, senderFrame: owner.webContents.mainFrame },
              "owner",
            ),
          ).toBe(true);
          yield* service.stop(99, "owner");
          expect(helper.destroy).not.toHaveBeenCalled();
        }),
      ).pipe(
        Effect.provideService(ElectronWindow.ElectronWindow, {
          main: Effect.succeedSome(owner as unknown as BrowserWindow),
          create,
        } as unknown as ElectronWindow.ElectronWindow["Service"]),
        Effect.provideService(DesktopEnvironment.DesktopEnvironment, {
          dirname: "/bundle",
          path: { join: (...parts: string[]) => parts.join("/") },
        } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
      );
      expect(helper.destroy).toHaveBeenCalledOnce();
      expect(owner.webContents.listenerCount("did-navigate")).toBe(0);
    }),
);

it("starts lazily in an isolated sandbox and configures only its own helper scale", async () => {
  const f = fixture();
  expect(f.create).not.toHaveBeenCalled();
  expect(await f.service.connect("a")).toBe(true);
  expect(f.create.mock.calls[0]![0]).toMatchObject({
    show: false,
    focusable: false,
    parent: f.owner,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  });
  const permission = boundary.session.setPermissionCheckHandler.mock.calls[0]![0];
  expect(permission()).toBe(false);
  const request = boundary.session.webRequest.onBeforeRequest.mock.calls[0]![0];
  const decision = vi.fn();
  request({ url: "https://example.com/font.woff" }, decision);
  expect(decision).toHaveBeenCalledWith({ cancel: true });
  expect(f.service.scale(99, "a", 2)).toBe(false);
  expect(f.service.scale(2, "old", 2)).toBe(false);
  expect(f.service.scale(2, "a", 1.25)).toBe(true);
  expect(f.helpers[0]!.webContents.enableDeviceEmulation).toHaveBeenCalledWith(
    expect.objectContaining({ deviceScaleFactor: 1.25 }),
  );
  await f.service.dispose();
});

it("retains a helper after cancelled close or navigation and same-document navigation, then releases it on destruction", async () => {
  const f = fixture();
  await f.service.connect("a");
  f.owner.emit("close", { preventDefault() {} });
  f.owner.webContents.emit("did-start-navigation", { isSameDocument: false, isMainFrame: true });
  f.owner.webContents.emit("did-navigate-in-page", {}, "t3code://app/route", true);
  expect(f.helpers[0]!.destroy).not.toHaveBeenCalled();
  f.owner.destroy();
  await f.service.dispose();
  expect(f.helpers[0]!.destroy).toHaveBeenCalledOnce();
  expect(boundary.ports.every((port) => port.close.mock.calls.length === 1)).toBe(true);
  expect(await f.service.connect("b")).toBe(false);
});

it("latches helper loss for one document and ignores its late stop after replacement", async () => {
  const f = fixture();
  await f.service.connect("a");
  f.helpers[0]!.webContents.emit("render-process-gone");
  await f.service.stop("a");
  expect(f.helpers[0]!.destroy).toHaveBeenCalledOnce();
  expect(await f.service.connect("a")).toBe(false);
  f.owner.webContents.emit("did-navigate");
  expect(await f.service.connect("b")).toBe(true);
  await f.service.stop("a");
  expect(f.helpers[1]!.destroy).not.toHaveBeenCalled();
  expect(f.service.scale(3, "b", 2)).toBe(true);
  await f.service.dispose();
});

it("does not await a hung load to tear down, and a late load rejection cannot destroy its replacement", async () => {
  const f = fixture();
  const load = Promise.withResolvers<void>();
  f.create.mockImplementationOnce(async () => {
    const helper = new Window(2);
    helper.loading = load.promise;
    f.helpers.push(helper);
    return helper as unknown as BrowserWindow;
  });
  const connecting = f.service.connect("a");
  await Promise.resolve();
  await f.service.stop("a");
  expect(f.helpers[0]!.destroy).toHaveBeenCalledOnce();
  f.owner.webContents.emit("did-navigate");
  expect(await f.service.connect("b")).toBe(true);
  load.reject(new Error("late load failure"));
  expect(await connecting).toBe(false);
  expect(f.helpers[1]!.destroy).not.toHaveBeenCalled();
  await f.service.dispose();
});

it("waits for acquired windows to be destroyed before stop settles", async () => {
  const f = fixture();
  const created = Promise.withResolvers<BrowserWindow>();
  f.create.mockReturnValueOnce(created.promise);
  const connecting = f.service.connect("a");
  let stopped = false;
  const stopping = f.service.stop("a").then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  const helper = new Window(2);
  created.resolve(helper as unknown as BrowserWindow);
  await stopping;
  expect(helper.destroy).toHaveBeenCalledOnce();
  expect(await connecting).toBe(false);
  expect(f.owner.webContents.postMessage).not.toHaveBeenCalled();
  await f.service.dispose();
});

it("cleans a failed load and releases a pending job after owner process loss", async () => {
  const f = fixture();
  f.create.mockRejectedValueOnce(new Error("window unavailable"));
  expect(await f.service.connect("a")).toBe(false);
  expect(await f.service.connect("a")).toBe(false);
  f.owner.webContents.emit("did-navigate");
  await f.service.connect("b");
  f.owner.webContents.emit("render-process-gone");
  await f.service.stop("b");
  expect(f.helpers[0]!.isDestroyed()).toBe(true);
  expect(f.owner.webContents.send).toHaveBeenCalledWith(Protocol.UNAVAILABLE, "b");
  await f.service.dispose();
});

it("falls back if the helper does not have a distinct renderer process", async () => {
  const f = fixture();
  f.create.mockImplementationOnce(async () => {
    const helper = new Window(1);
    f.helpers.push(helper);
    return helper as unknown as BrowserWindow;
  });
  expect(await f.service.connect("a")).toBe(false);
  expect(f.helpers[0]!.destroy).toHaveBeenCalledOnce();
  expect(f.owner.webContents.postMessage).not.toHaveBeenCalled();
  await f.service.dispose();
});

it("rejects a stale document before creation and after load without delivering its ports", async () => {
  const f = fixture();
  let currentDocument = false;
  expect(await f.service.connect("old", () => currentDocument)).toBe(false);
  expect(f.create).not.toHaveBeenCalled();
  currentDocument = true;
  const load = Promise.withResolvers<void>();
  f.create.mockImplementationOnce(async () => {
    const helper = new Window(2);
    helper.loading = load.promise;
    f.helpers.push(helper);
    return helper as unknown as BrowserWindow;
  });
  const connecting = f.service.connect("old", () => currentDocument);
  await Promise.resolve();
  currentDocument = false;
  f.owner.webContents.emit("did-navigate");
  expect(await f.service.connect("next")).toBe(true);
  load.resolve();
  expect(await connecting).toBe(false);
  expect(f.helpers[0]!.destroy).toHaveBeenCalledOnce();
  expect(f.owner.webContents.postMessage).toHaveBeenCalledOnce();
  expect(f.owner.webContents.postMessage).toHaveBeenCalledWith(
    Protocol.PORT,
    "next",
    expect.any(Array),
  );
  expect(f.helpers[1]!.destroy).not.toHaveBeenCalled();
  await f.service.dispose();
});

it("rechecks document ownership after acquisition before loading a helper", async () => {
  const f = fixture();
  const created = Promise.withResolvers<BrowserWindow>();
  f.create.mockReturnValueOnce(created.promise);
  let currentDocument = true;
  const connecting = f.service.connect("old", () => currentDocument);
  currentDocument = false;
  const helper = new Window(2);
  created.resolve(helper as unknown as BrowserWindow);
  expect(await connecting).toBe(false);
  expect(helper.loadURL).not.toHaveBeenCalled();
  expect(helper.destroy).toHaveBeenCalledOnce();
  expect(f.owner.webContents.postMessage).not.toHaveBeenCalled();
  await f.service.dispose();
});
