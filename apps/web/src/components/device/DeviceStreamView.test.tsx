import { act, useEffect, useSyncExternalStore, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

// Like the real atom, a refresh yields a new access object and re-renders subscribers.
const accessStore = {
  value: { httpBase: "http://test", wsBase: "ws://test", query: {}, credentials: true },
  listeners: new Set<() => void>(),
  refresh() {
    accessStore.value = { ...accessStore.value };
    for (const listener of accessStore.listeners) listener();
  },
  subscribe(listener: () => void) {
    accessStore.listeners.add(listener);
    return () => accessStore.listeners.delete(listener);
  },
};
vi.mock("~/state/device", () => ({
  useDeviceHubAccess: () => useSyncExternalStore(accessStore.subscribe, () => accessStore.value),
  refreshDeviceHubAccess: () => accessStore.refresh(),
}));
// Replace GPU allocation while keeping the real React and stream lifecycles.
let viewerMounts = 0;
let viewerUnmounts = 0;
let viewerProps: ComponentProps<typeof import("./DevicePhoneViewport").DevicePhoneViewport>;
vi.mock("./DevicePhoneViewport", () => ({
  DevicePhoneViewport: function Viewer(props: typeof viewerProps) {
    viewerProps = props;
    useEffect(() => {
      viewerMounts++;
      return () => {
        viewerUnmounts++;
      };
    }, []);
    return null;
  },
}));
const duoViewerFactory = vi.hoisted(() =>
  vi.fn<typeof import("@t3tools/client-runtime/device/duo-viewer").createDuoViewer>(),
);
vi.mock("@t3tools/client-runtime/device/duo-viewer", () => ({
  createDuoViewer: duoViewerFactory,
}));
import { DeviceStreamView } from "./DeviceStreamView";
import { DeviceDuoViewport } from "./DeviceDuoViewport";

class Image extends EventTarget {
  src = "";
  naturalWidth = 0;
  naturalHeight = 0;
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}
let renderer: ReactTestRenderer | undefined;
let primes = 0;
beforeEach(() => {
  primes = 0;
  viewerMounts = 0;
  viewerUnmounts = 0;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup({ scale = 1, h264 = false, duo = false } = {}) {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let videoBody: ReadableStreamDefaultController<Uint8Array> | undefined;
  let output: VideoFrameOutputCallback | undefined;
  const videos: Array<{
    url: string;
    signal: AbortSignal;
    body: ReadableStreamDefaultController<Uint8Array>;
  }> = [];
  if (h264) {
    vi.stubGlobal(
      "VideoDecoder",
      class {
        static isConfigSupported = async () => ({ supported: true });
        state = "unconfigured";
        constructor(callbacks: VideoDecoderInit) {
          output = callbacks.output;
        }
        configure() {
          this.state = "configured";
        }
        close() {
          this.state = "closed";
        }
      },
    );
    vi.stubGlobal("EncodedVideoChunk", vi.fn());
  }
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (url.endsWith("stream.avcc")) {
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              videoBody = controller;
              videos.push({ url, signal: init.signal!, body: controller });
              init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
            },
          }),
        ),
      );
    }
    primes++;
    return Promise.resolve(new Response("prime"));
  });
  const sockets: Array<{
    onmessage?: (event: { data: ArrayBuffer }) => void;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      constructor() {
        sockets.push(this);
      }
      onmessage?: (event: { data: ArrayBuffer }) => void;
      send = vi.fn();
      close = vi.fn();
    },
  );
  let measure = () => {};
  const host = {
    clientWidth: 400,
    clientHeight: 800,
    style: { setProperty() {} },
    getContext: () => ({ drawImage() {} }),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: host.clientWidth * scale,
      height: host.clientHeight * scale,
    }),
  };
  const interactiveCanvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: host.getBoundingClientRect,
    setPointerCapture: vi.fn(),
    closest: () => null,
  });
  if (duo) {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        devicePixelRatio: 1,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      }),
    );
    vi.stubGlobal("getComputedStyle", () => ({
      width: `${host.clientWidth}px`,
      boxSizing: "border-box",
    }));
    vi.stubGlobal("document", {
      createElement() {
        const context = { drawImage: vi.fn() };
        return { width: 0, height: 0, getContext: () => context };
      },
    });
  }
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        measure = () =>
          callback(
            [
              { target: host, contentRect: { width: host.clientWidth, height: host.clientHeight } },
            ] as unknown as ResizeObserverEntry[],
            this as unknown as ResizeObserver,
          );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const images: Image[] = [];
  const view = (
    visible: boolean,
    overrides: Partial<ComponentProps<typeof DeviceStreamView>> = {},
  ) => (
    <DeviceStreamView
      hostId="local"
      environmentId={EnvironmentId.make("test")}
      deviceId="test"
      platform="ios"
      visible={visible}
      allowPhoneView={h264}
      {...(duo ? { deviceName: "iPhone Duo" } : {})}
      {...overrides}
    />
  );
  await act(async () => {
    renderer = create(view(true), {
      createNodeMock: (node) => {
        if (node.type === "img") {
          const image = new Image();
          images.push(image);
          return image;
        }
        if (
          node.type === "canvas" &&
          typeof node.props === "object" &&
          node.props !== null &&
          "aria-label" in node.props
        )
          return interactiveCanvas;
        return host;
      },
    });
  });
  return {
    images,
    view,
    sockets,
    videos,
    output: () => output!,
    touch() {
      const canvas = renderer!.root
        .findAllByType("canvas")
        .find((node) => node.props["aria-label"]);
      const event = {
        button: 0,
        pointerId: 1,
        clientX: host.clientWidth * scale * 0.25,
        clientY: host.clientHeight * scale * 0.5,
        currentTarget: interactiveCanvas,
        preventDefault() {},
      };
      canvas!.props.onPointerDown(event);
      canvas!.props.onPointerUp(event);
    },
    describeVideo(body: ReadableStreamDefaultController<Uint8Array>) {
      body.enqueue(new Uint8Array([0, 0, 0, 5, 1, 1, 0x64, 0, 0x1f]));
    },
    resize(width: number, height: number) {
      host.clientWidth = width;
      host.clientHeight = height;
      measure();
    },
    configure(orientation = "portrait") {
      const json = new TextEncoder().encode(
        JSON.stringify({
          width: 400,
          height: 800,
          orientation,
          ...(duo ? { screenId: 3, hingeAngle: 180, supportsHingeAngle: true } : {}),
        }),
      );
      const packet = new Uint8Array(1 + json.length);
      packet[0] = 0x82;
      packet.set(json, 1);
      sockets.at(-1)?.onmessage?.({ data: Uint8Array.of(0x83).buffer });
      sockets.at(-1)?.onmessage?.({ data: packet.buffer });
      videoBody?.enqueue(new Uint8Array([0, 0, 0, 5, 1, 1, 0x64, 0, 0x1f]));
    },
    frame(callback = output) {
      const frame = { displayWidth: 400, displayHeight: 800, close: vi.fn() };
      callback?.(frame as unknown as VideoFrame);
      return frame;
    },
  };
}

it.each([1, 0.3, 1.5])("fits the device frame in local dimensions at %s zoom", async (scale) => {
  const { images, resize } = await setup({ scale });
  await act(async () => {
    images[0]!.naturalWidth = 400;
    images[0]!.naturalHeight = 800;
    images[0]!.dispatchEvent(new Event("load"));
  });
  const frame = () => renderer!.root.findByType("img").props.style;
  expect(frame().height).toBe(800);
  expect(frame().width).toBeCloseTo((800 * 9) / 19.5);
  await act(async () => resize(240, 320));
  expect(frame().height).toBe(320);
  expect(frame().width).toBeCloseTo((320 * 9) / 19.5);
  await act(async () => resize(180, 500));
  expect(frame()).toMatchObject({ width: 180, height: 390 });
  await act(async () => resize(0, 0));
  expect(frame()).toMatchObject({ width: 0, height: 0 });
  await act(async () => resize(300, 600));
  expect(frame().height).toBe(600);
  expect(frame().width).toBeCloseTo((600 * 9) / 19.5);
});

it("removes MJPEG requests while hidden and reconnects when shown", async () => {
  const { images, view } = await setup();
  expect(images[0]!.src).toContain("stream.mjpeg");
  await act(async () => renderer!.update(view(false)));
  expect(renderer!.root.findAllByType("img")).toHaveLength(0);
  expect(images[0]!.src).toBe("");
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => renderer!.update(view(true)));
  expect(images.at(-1)!.src).toContain("stream.mjpeg");
});

it("offers Reconnect after the shared timeout and receives a frame after retry with unchanged access", async () => {
  const { images } = await setup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(
    renderer!.root.findByProps({ role: "alert" }).findByType("span").children.join(""),
  ).toContain("No video");
  expect(images[0]!.src).toBe("");
  await act(async () => renderer!.root.findByType("button").props.onClick());
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(images[1]!.src).toContain("stream.mjpeg");
  await act(async () => {
    images[1]!.naturalWidth = 400;
    images[1]!.naturalHeight = 800;
    images[1]!.dispatchEvent(new Event("load"));
  });
  expect(renderer!.root.findAllByProps({ role: "status" })).toHaveLength(0);
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("starts exactly one new stream per Reconnect press", async () => {
  await setup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(primes).toBe(1);
  await act(async () => renderer!.root.findByType("button").props.onClick());
  expect(primes).toBe(2);
});

it("retains the same 3D viewer and screen while hidden, stops transport, and resumes current input", async () => {
  const { configure, frame, view, sockets } = await setup({ h264: true });
  await act(async () => configure("landscape_left"));
  expect(viewerMounts).toBe(0);
  await act(async () => frame());
  expect(viewerMounts).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(viewerUnmounts).toBe(0);
  expect(viewerMounts).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
    configure("landscape_left");
  });
  await act(async () => frame());
  expect(viewerMounts).toBe(1);
  const screen = viewerProps.screen;
  const previousClient = viewerProps.client.current;
  const previousSocket = sockets.at(-1)!;
  await act(async () => renderer!.update(view(false)));
  expect(viewerUnmounts).toBe(0);
  expect(viewerProps.active).toBe(false);
  expect(viewerProps.screen).toBe(screen);
  expect(viewerProps.client.current).toBeNull();
  expect(previousSocket.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => renderer!.update(view(true)));
  expect(viewerMounts).toBe(1);
  expect(viewerProps.active).toBe(true);
  expect(viewerProps.screen).toBe(screen);
  expect(viewerProps.client.current).not.toBe(previousClient);
  await act(async () => configure("portrait"));
  expect(viewerProps.screen?.orientation).toBe("portrait");
  const previousSends = previousSocket.send.mock.calls.length;
  const currentSocket = sockets.at(-1)!;
  currentSocket.send.mockClear();
  viewerProps.client.current?.sendTouch("begin", 0.25, 0.5);
  expect(currentSocket.send).toHaveBeenCalledOnce();
  expect(previousSocket.send).toHaveBeenCalledTimes(previousSends);
  await act(async () => frame());
  expect(viewerMounts).toBe(1);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(viewerUnmounts).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the real Duo stream admitted across hide, return, and same-client Reconnect", async () => {
  const viewer = {
    setActive: vi.fn(),
    setScreen: vi.fn(),
    setHingePreview: vi.fn(),
    setInteractionActive: vi.fn(),
    rejectOrientation: vi.fn(),
    frameUpdated: vi.fn(),
    resize: vi.fn(),
    screenPoint: vi.fn((x: number, y: number) => ({ x, y })),
    orbit: vi.fn(),
    beginHinge: vi.fn(() => false),
    resetPose: vi.fn(),
    cancelInput: vi.fn(),
    dispose: vi.fn(),
  };
  duoViewerFactory.mockReturnValue(viewer);
  const fixture = await setup({ h264: true, duo: true });
  const { configure, frame, view, sockets, videos, describeVideo, touch } = fixture;
  const viewport = () => renderer!.root.findByType(DeviceDuoViewport);
  const activeVideos = () => videos.filter((video) => !video.signal.aborted);
  const outputs = new Map<ReadableStreamDefaultController<Uint8Array>, VideoFrameOutputCallback>();
  const paintPanels = async () => {
    const feeds = activeVideos();
    expect(feeds.map((feed) => new URL(feed.url).pathname)).toEqual([
      "/vendor/serve-sim/helper/test/panel/1/stream.avcc",
      "/vendor/serve-sim/helper/test/panel/3/stream.avcc",
    ]);
    for (const feed of feeds) {
      await act(async () => describeVideo(feed.body));
      if (!outputs.has(feed.body)) outputs.set(feed.body, fixture.output());
      await act(async () => frame(outputs.get(feed.body)));
    }
    expect(viewer.frameUpdated).toHaveBeenCalledWith(3);
  };
  await act(async () => configure());
  await act(async () => frame());
  await paintPanels();
  const retained = duoViewerFactory.mock.calls[0]![0].sources;
  const innerPaint = vi.mocked(retained[3].getContext("2d")!.drawImage);
  expect(innerPaint).toHaveBeenCalledOnce();
  const firstClient = viewport().props.stream;
  const firstSocket = sockets.at(-1)!;
  const oldOutput = fixture.output();
  touch();
  expect(firstSocket.send).toHaveBeenCalled();

  await act(async () => renderer!.update(view(false)));
  expect(activeVideos()).toHaveLength(0);
  expect(firstSocket.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(viewer.dispose).not.toHaveBeenCalled();
  await act(async () => renderer!.update(view(true)));
  await act(async () => configure());
  await act(async () => frame());
  await paintPanels();
  expect(viewport().props.stream).not.toBe(firstClient);
  expect(innerPaint).toHaveBeenCalledTimes(2);
  const currentFeeds = activeVideos();
  const oldSends = firstSocket.send.mock.calls.length;
  const currentSocket = sockets.at(-1)!;
  await act(async () => {
    firstClient.setDuoPanels(null);
    firstSocket.onmessage?.({ data: Uint8Array.of(0x83).buffer });
    frame(oldOutput);
  });
  expect(activeVideos()).toEqual(currentFeeds);
  expect(innerPaint).toHaveBeenCalledTimes(2);
  touch();
  expect(currentSocket.send).toHaveBeenCalled();
  expect(firstSocket.send).toHaveBeenCalledTimes(oldSends);
  await act(async () => vi.advanceTimersByTimeAsync(14_000));
  await paintPanels();
  await act(async () => vi.advanceTimersByTimeAsync(1_001));
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(activeVideos()).toHaveLength(2);

  await act(async () => renderer!.update(view(false)));
  await act(async () => renderer!.update(view(true)));
  const restartingClient = viewport().props.client.current;
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  const reconnect = renderer!.root
    .findAllByType("button")
    .find((button) => button.children.includes("Reconnect"))!;
  await act(async () => reconnect.props.onClick());
  expect(viewport().props.client.current).toBe(restartingClient);
  await act(async () => configure());
  await act(async () => frame());
  await paintPanels();
  expect(viewport().props.stream).toBe(restartingClient);
  expect(duoViewerFactory).toHaveBeenCalledOnce();
  touch();
  expect(sockets.at(-1)!.send).toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(14_000));
  await paintPanels();
  await act(async () => vi.advanceTimersByTimeAsync(1_001));
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(activeVideos()).toHaveLength(0);
  expect(viewer.dispose).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["deviceId", "hostId", "environmentId", "platform"] as const)(
  "releases the previous viewer when %s changes and waits for the new device frame",
  async (key) => {
    const { configure, frame, view } = await setup({ h264: true });
    await act(async () => configure());
    await act(async () => frame());
    expect(viewerMounts).toBe(1);
    await act(async () => {
      renderer!.update(view(true, { [key]: key === "platform" ? "android" : "another" }));
    });
    expect(viewerUnmounts).toBe(1);
    expect(viewerMounts).toBe(1);
  },
);

it("disposes the 3D viewer on flat selection and on renderer failure", async () => {
  const { configure, frame } = await setup({ h264: true });
  await act(async () => configure());
  await act(async () => frame());
  const button = (label: string) =>
    renderer!.root.findAllByType("button").find((node) => node.children.includes(label))!;
  await act(async () => button("Flat").props.onClick());
  expect(viewerUnmounts).toBe(1);
  await act(async () => button("3D").props.onClick());
  expect(viewerMounts).toBe(2);
  await act(async () => viewerProps.onUnavailable());
  expect(viewerUnmounts).toBe(2);
  expect(button("3D").props.disabled).toBe(true);
});
