import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { DeviceStreamClient, DuoPanelSinks } from "@t3tools/client-runtime/device/stream";
import { IOS_PHONE_SHAPE } from "@t3tools/client-runtime/device/shape-profile";

const viewers = vi.hoisted(() => ({ phone: vi.fn(), duo: vi.fn() }));
vi.mock("@t3tools/client-runtime/device/phone-viewer", () => ({
  createPhoneViewer: viewers.phone,
}));
vi.mock("@t3tools/client-runtime/device/duo-viewer", () => ({ createDuoViewer: viewers.duo }));
import { DevicePhoneViewport } from "./DevicePhoneViewport";
import { DeviceDuoViewport } from "./DeviceDuoViewport";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function stream() {
  return {
    sendTouch: vi.fn(),
    sendRawTouch: vi.fn(),
    controlDuo: vi.fn(),
    setDuoPanels: vi.fn<(panels: DuoPanelSinks | null) => void>(),
  } as unknown as DeviceStreamClient;
}

async function fixture(kind: "phone" | "duo", initialScale = 0.3) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const window = Object.assign(new EventTarget(), { devicePixelRatio: 1.75 });
  vi.stubGlobal("window", window);
  let width = 431.375;
  let height = 687.625;
  let scale = initialScale;
  const rect = () => ({
    left: 10,
    top: 20,
    right: 10 + width * scale,
    bottom: 20 + height * scale,
    width: width * scale,
    height: height * scale,
  });
  const host = { getBoundingClientRect: rect };
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: rect,
    setPointerCapture: vi.fn(),
    closest: () => null,
  });
  const decoded = { width: 400, height: 800 } as HTMLCanvasElement;
  vi.stubGlobal("getComputedStyle", () => ({ width: `${width}px`, boxSizing: "border-box" }));
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }),
  });
  let measure = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        measure = () =>
          callback(
            [{ target: host, contentRect: { width, height } }] as unknown as ResizeObserverEntry[],
            this as unknown as ResizeObserver,
          );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const viewer = {
    setActive: vi.fn(),
    setModel: vi.fn(),
    setAccessory: vi.fn(),
    setFoldAngle: vi.fn(),
    setScreen: vi.fn(),
    setHingePreview: vi.fn(),
    setInteractionActive: vi.fn(),
    frameUpdated: vi.fn(),
    resize: vi.fn(),
    resetPose: vi.fn(),
    rejectOrientation: vi.fn(),
    beginHinge: vi.fn(),
    cancelInput: vi.fn(),
    screenPoint: vi.fn((x: number, y: number) => ({ x, y })),
    orbit: vi.fn(),
    dispose: vi.fn(),
  };
  viewers[kind].mockReturnValue(viewer);
  const first = stream();
  const client = { current: first as DeviceStreamClient | null };
  const shared = {
    source: { current: decoded },
    client,
    screen: {
      width: 400,
      height: 800,
      orientation: "portrait" as const,
      screenId: 1,
      hingeAngle: 0,
      supportsHingeAngle: true,
    },
    onUnavailable: vi.fn(),
    onFrameListener: vi.fn(),
    onResetReady: vi.fn(),
    onInputCancel: vi.fn(),
  };
  const model = { id: "iphone-duo" as const, url: "/duo.glb" };
  const view = (active: boolean, stream: DeviceStreamClient | null = client.current) =>
    kind === "phone" ? (
      <DevicePhoneViewport
        {...shared}
        active={active}
        model={null}
        accessory={null}
        foldAngle={null}
        profile={IOS_PHONE_SHAPE}
      />
    ) : (
      <DeviceDuoViewport
        {...shared}
        active={active}
        stream={stream}
        model={model}
        hingePreview={null}
        controlError={null}
      />
    );
  await act(async () => {
    renderer = create(view(true), {
      createNodeMock: (node) => (node.type === "canvas" ? canvas : host),
    });
  });
  const touch = () => {
    const bounds = rect();
    renderer!.root.findByType("canvas").props.onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: bounds.left + bounds.width * 0.25,
      clientY: bounds.top + bounds.height * 0.5,
      currentTarget: canvas,
      preventDefault() {},
    });
  };
  return {
    viewer,
    view,
    client,
    first,
    touch,
    resize(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
      measure();
    },
    zoom(next: number, ratio = window.devicePixelRatio) {
      scale = next;
      window.devicePixelRatio = ratio;
    },
  };
}

it.each(["phone", "duo"] as const)(
  "%s retains its viewer, cancels contact while hidden, and uses the replacement input client",
  async (kind) => {
    const { viewer, view, client, first, touch } = await fixture(kind);
    touch();
    const send = kind === "phone" ? "sendTouch" : "sendRawTouch";
    expect(first[send]).toHaveBeenLastCalledWith("begin", 0.25, 0.5);
    await act(async () => renderer!.update(view(false, null)));
    expect(first[send]).toHaveBeenLastCalledWith("end", 0.25, 0.5);
    expect(viewer.setActive).toHaveBeenLastCalledWith(false);
    expect(viewer.dispose).not.toHaveBeenCalled();
    const second = stream();
    client.current = second;
    await act(async () => renderer!.update(view(true)));
    expect(viewers[kind]).toHaveBeenCalledOnce();
    expect(viewer.setActive).toHaveBeenLastCalledWith(true);
    touch();
    expect(second[send]).toHaveBeenLastCalledWith("begin", 0.25, 0.5);
    expect(first[send]).toHaveBeenCalledTimes(2);
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(viewer.dispose).toHaveBeenCalledOnce();
  },
);

it.each(["phone", "duo"] as const)(
  "%s sizes its backing buffer in fractional layout pixels at overview and restored zoom",
  async (kind) => {
    const { viewer, view, resize, zoom } = await fixture(kind);
    expect(viewer.resize).toHaveBeenLastCalledWith(431.375, 687.625, 1.75);
    await act(async () => resize(294.25, 521.5));
    expect(viewer.resize).toHaveBeenLastCalledWith(294.25, 521.5, 1.75);
    await act(async () => renderer!.update(view(false, null)));
    zoom(1.5, 2);
    await act(async () => renderer!.update(view(true)));
    expect(viewer.resize).toHaveBeenLastCalledWith(294.25, 521.5, 2);
    expect(viewers[kind]).toHaveBeenCalledOnce();
  },
);

it("rebinds retained Duo panel canvases to the actual new client and only detaches their owner", async () => {
  const { viewer, view, client, first } = await fixture("duo");
  const sinks = vi.mocked(first.setDuoPanels).mock.calls[0]![0]!;
  expect(sinks).toBeDefined();
  const second = stream();
  client.current = second;
  await act(async () => renderer!.update(view(true)));
  expect(first.setDuoPanels).toHaveBeenLastCalledWith(null);
  expect(second.setDuoPanels).toHaveBeenCalledExactlyOnceWith(sinks);
  viewer.frameUpdated.mockClear();
  sinks.cover.present({} as CanvasImageSource, 400, 800);
  expect(viewer.frameUpdated).toHaveBeenCalledExactlyOnceWith(1);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(first.setDuoPanels).toHaveBeenCalledTimes(2);
  expect(second.setDuoPanels).toHaveBeenLastCalledWith(null);
  expect(viewer.dispose).toHaveBeenCalledOnce();
});
