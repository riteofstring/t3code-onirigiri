import { afterEach, expect, it, vi } from "vite-plus/test";
import { createDeviceStreamClient, type DeviceScreenSize } from "./stream.ts";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function createDuoStreamFixture() {
  const feeds: {
    url: string;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<Uint8Array>;
  }[] = [];
  const outputs: VideoFrameOutputCallback[] = [];
  const errors: VideoDecoderInit["error"][] = [];
  let supported = true;
  let panelHttpStatus = 200;
  let expected = 0;
  let decoderReady = () => {};
  const waitDecoders = (count: number) => {
    expected = count;
    return new Promise<void>((resolve) => {
      decoderReady = resolve;
    });
  };
  class Decoder {
    static isConfigSupported = async () => ({ supported });
    static instances: Decoder[] = [];
    state = "unconfigured";
    constructor(options: VideoDecoderInit) {
      outputs.push(options.output);
      errors.push(options.error);
      Decoder.instances.push(this);
      if (outputs.length === expected) decoderReady();
    }
    configure() {
      this.state = "configured";
    }
    close() {
      this.state = "closed";
    }
  }
  let socketReady = () => {};
  const socketConstructed = new Promise<void>((resolve) => {
    socketReady = resolve;
  });
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    binaryType = "arraybuffer";
    onopen?: () => void;
    onmessage?: (event: { data: ArrayBuffer }) => void;
    onclose?: (event: { code: number; reason: string }) => void;
    send = vi.fn();
    close = vi.fn();
    constructor() {
      Socket.instances.push(this);
      socketReady();
    }
  }
  vi.stubGlobal("VideoDecoder", Decoder);
  vi.stubGlobal("EncodedVideoChunk", vi.fn());
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: { signal: AbortSignal }) => {
      if (!url.includes("avcc")) return new Response("prime");
      if (url.includes("/panel/") && panelHttpStatus !== 200)
        return new Response("unsupported panel", { status: panelHttpStatus });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          feeds.push({ url, signal: options.signal, controller });
          options.signal.addEventListener("abort", () =>
            controller.error(new DOMException("Aborted", "AbortError")),
          );
        },
      });
      return new Response(stream);
    }),
  );
  const present = vi.fn((_source: CanvasImageSource, _width: number, _height: number) => true),
    cover = vi.fn((_source: CanvasImageSource, _width: number, _height: number) => true),
    inner = vi.fn((_source: CanvasImageSource, _width: number, _height: number) => true);
  let panelFailed = () => {};
  const waitPanelFailure = () =>
    new Promise<void>((resolve) => {
      panelFailed = resolve;
    });
  const onStatus = vi.fn();
  const onDuoControl = vi.fn();
  const onDuoUnavailable = vi.fn((_detail?: string) => panelFailed());
  const client = createDeviceStreamClient(
    {
      platform: "ios",
      deviceId: "duo",
      access: {
        httpBase: "https://t3.test/api/device-hub",
        wsBase: "wss://t3.test/api/device-hub",
        credentials: true,
        query: { hostId: "remote", wsTicket: "ticket" },
      },
    },
    { present },
    {
      onStatus,
      onDuoControl,
      onDuoUnavailable,
      onScreen: vi.fn(),
      onInputConnected: vi.fn(),
      onUnauthorized: vi.fn(),
      onMjpegFallback: vi.fn(),
    },
  );
  client.start();
  await socketConstructed;
  const ws = Socket.instances[0]!;
  ws.onmessage?.({ data: Uint8Array.of(0x83).buffer });
  const config = (
    id: number,
    orientation: DeviceScreenSize["orientation"] = "portrait",
    physical = false,
  ) => {
    const json = new TextEncoder().encode(
      JSON.stringify({
        width: id === 1 ? 1398 : 2007,
        height: id === 1 ? 2034 : 2853,
        orientation,
        screenId: id,
        supportsHingeAngle: true,
        supportsPhysicalOrientation: physical,
        hingePose: "open",
      }),
    );
    const packet = new Uint8Array(json.length + 1);
    packet[0] = 0x82;
    packet.set(json, 1);
    ws.onmessage?.({ data: packet.buffer });
  };
  return {
    feeds,
    outputs,
    errors,
    Decoder,
    Socket,
    present,
    cover,
    inner,
    onStatus,
    onDuoControl,
    onDuoUnavailable,
    client,
    ws,
    config,
    waitDecoders,
    waitPanelFailure,
    setSupported(value: boolean) {
      supported = value;
    },
    setPanelHttpStatus(value: number) {
      panelHttpStatus = value;
    },
  };
}

it.each([
  { kind: "active fixed panel", physical: false, active: true, primary: true, panel: true },
  { kind: "physical display", physical: true, active: true, primary: true, panel: true },
  { kind: "inactive fixed panel", physical: false, active: false, primary: true, panel: true },
  { kind: "rejected primary sink", physical: false, active: true, primary: false, panel: true },
  { kind: "rejected panel sink", physical: false, active: true, primary: true, panel: false },
  { kind: "rejected physical sink", physical: true, active: true, primary: false, panel: true },
])("settles the first-frame deadline only for displayed $kind pixels", async (testCase) => {
  vi.useFakeTimers();
  const { client, config, feeds, outputs, present, cover, inner, onStatus, waitDecoders } =
    await createDuoStreamFixture();
  present.mockReturnValue(testCase.primary);
  inner.mockReturnValue(testCase.panel);
  config(3, "portrait", testCase.physical);
  client.setDuoPanels({ cover: { present: cover }, inner: { present: inner } });
  const decoderCount = testCase.physical ? 1 : 2;
  const ready = waitDecoders(decoderCount);
  const description = new Uint8Array([0, 0, 0, 5, 1, 1, 0x64, 0, 0x1f]);
  for (const feed of feeds.slice(1)) feed.controller.enqueue(description);
  await ready;
  expect(onStatus).toHaveBeenLastCalledWith("connecting", undefined);
  await vi.advanceTimersByTimeAsync(14_000);
  const frame = {
    displayWidth: 2007,
    displayHeight: 2853,
    close: vi.fn(),
  } as unknown as VideoFrame;
  outputs[testCase.physical || !testCase.active ? 0 : 1]!(frame);
  const displayed = testCase.active && testCase.primary && testCase.panel;
  expect(present).toHaveBeenCalledTimes(testCase.active ? 1 : 0);
  expect(onStatus).toHaveBeenLastCalledWith(displayed ? "streaming" : "connecting", undefined);
  await vi.advanceTimersByTimeAsync(1_001);
  if (displayed) {
    expect(onStatus).toHaveBeenLastCalledWith("streaming", undefined);
  } else {
    expect(onStatus).toHaveBeenLastCalledWith(
      "error",
      "No video received from the device. Reconnect to try again.",
    );
  }
  client.stop();
  expect(vi.getTimerCount()).toBe(0);
});
