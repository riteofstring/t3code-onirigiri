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

it("switches to fixed authenticated feeds while retaining one HID socket, routes the active panel and rejects superseded decoded output", async () => {
  const {
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
    setSupported,
    setPanelHttpStatus,
  } = await createDuoStreamFixture();
  config(3);
  const requestedOrientation = () =>
    JSON.parse(new TextDecoder().decode(ws.send.mock.lastCall?.[0].subarray(1))).orientation;
  client.rotate();
  expect(requestedOrientation()).toBe("landscape_left");
  config(3); // An orientation-locked app keeps its framebuffer orientation after the sensor rotates.
  expect(onDuoControl.mock.lastCall?.[0].error).toBeNull();
  client.rotate();
  expect(requestedOrientation()).toBe("portrait_upside_down");
  config(3, "portrait_upside_down");
  client.rotate();
  expect(requestedOrientation()).toBe("landscape_right");
  config(3); // An external native orientation change becomes authoritative again.
  client.rotate();
  expect(requestedOrientation()).toBe("landscape_left");
  config(3, "landscape_left");
  expect(onDuoControl.mock.lastCall?.[0].pending).toBe(false);
  client.controlDuo({ control: "angle", value: 40 });
  const angleRequest = JSON.parse(new TextDecoder().decode(ws.send.mock.lastCall?.[0].subarray(1)));
  const before = ws.send.mock.calls.length;
  client.controlDuo({ control: "orientation", value: "portrait" });
  expect(ws.send.mock.calls.length).toBe(before);
  config(3, "landscape_left"); // The angle's config precedes its receipt; it cannot acknowledge a queued rotation.
  const reply = new TextEncoder().encode(
    JSON.stringify({ requestId: angleRequest.requestId, ok: true }),
  );
  const receipt = new Uint8Array(reply.length + 1);
  receipt[0] = 0x90;
  receipt.set(reply, 1);
  ws.onmessage?.({ data: receipt.buffer });
  expect(requestedOrientation()).toBe("portrait");
  expect(ws.send.mock.lastCall?.[0][0]).toBe(0x07);
  client.controlDuo({ control: "angle", value: 55 });
  const orientationSends = ws.send.mock.calls.length;
  expect(onDuoControl.mock.lastCall?.[0].pending).toBe(true);
  config(3);
  expect(ws.send.mock.calls.length).toBe(orientationSends + 1);
  const after = JSON.parse(new TextDecoder().decode(ws.send.mock.lastCall?.[0].subarray(1)));
  expect(after.command).toEqual({ control: "angle", value: 55 });
  const finalReply = new TextEncoder().encode(
    JSON.stringify({ requestId: after.requestId, ok: true }),
  );
  const finalReceipt = new Uint8Array(finalReply.length + 1);
  finalReceipt[0] = 0x90;
  finalReceipt.set(finalReply, 1);
  ws.onmessage?.({ data: finalReceipt.buffer });
  expect(onDuoControl.mock.lastCall?.[0].pending).toBe(false);
  const description = new Uint8Array([0, 0, 0, 5, 1, 1, 0x64, 0, 0x1f]);
  let ready = waitDecoders(1);
  feeds[0]!.controller.enqueue(description);
  await ready;
  client.setDuoPanels({ cover: { present: cover }, inner: { present: inner } });
  expect(feeds[0]!.signal.aborted).toBe(true);
  expect(Socket.instances).toHaveLength(1);
  for (const [index, id] of [
    [1, 1],
    [2, 3],
  ]) {
    const url = new URL(feeds[index!]!.url);
    expect(url.pathname.endsWith(`/panel/${id}/stream.avcc`)).toBe(true);
    expect(url.searchParams.get("hostId")).toBe("remote");
    expect(url.searchParams.get("wsTicket")).toBe("ticket");
  }
  ready = waitDecoders(3);
  feeds[1]!.controller.enqueue(description);
  feeds[2]!.controller.enqueue(description);
  await ready;
  const frame = {
    displayWidth: 2007,
    displayHeight: 2853,
    close: vi.fn(),
  } as unknown as VideoFrame;
  outputs[0]!(frame);
  expect(present).not.toHaveBeenCalled();
  expect(onStatus).toHaveBeenLastCalledWith("connecting", undefined);
  outputs[1]!(frame);
  expect(cover).not.toHaveBeenCalled();
  expect(onStatus).toHaveBeenLastCalledWith("connecting", undefined);
  outputs[2]!(frame);
  expect(inner).toHaveBeenCalledOnce();
  expect(present).toHaveBeenCalledOnce();
  expect(onStatus).toHaveBeenLastCalledWith("streaming", undefined);
  config(1);
  outputs[2]!(frame);
  expect(inner).toHaveBeenCalledOnce();
  outputs[1]!(frame);
  expect(cover).toHaveBeenCalledOnce();
  client.setDuoPanels(null);
  expect(feeds[1]!.signal.aborted).toBe(true);
  expect(feeds[2]!.signal.aborted).toBe(true);
  expect(feeds[3]!.url).not.toContain("/panel/");
  outputs[1]!(frame);
  expect(cover).toHaveBeenCalledOnce();
  ready = waitDecoders(4);
  feeds[3]!.controller.enqueue(description);
  await ready;
  errors[0]!(new DOMException("Late decoder failure"));
  expect(Decoder.instances[3]!.state).toBe("configured");
  config(1, "portrait", true);
  client.setDuoPanels({ cover: { present: cover }, inner: { present: inner } });
  expect(feeds).toHaveLength(5); // One active feed replaces the two fixed feeds.
  expect(feeds[4]!.url).not.toContain("/panel/");
  expect(new URL(feeds[4]!.url).searchParams.get("hostId")).toBe("remote");
  ready = waitDecoders(5);
  feeds[4]!.controller.enqueue(description);
  await ready;
  const primary = { ...frame, displayWidth: 1398, displayHeight: 2034 } as VideoFrame;
  const painted = present.mock.calls.length;
  outputs[4]!(primary);
  expect(present).toHaveBeenCalledTimes(painted + 1);
  expect(present.mock.lastCall?.[0]).toBe(primary);
  expect(cover).toHaveBeenCalledOnce(); // The main sink owns primary texture delivery.
  config(3, "portrait", true);
  expect(feeds[4]!.signal.aborted).toBe(true);
  expect(feeds).toHaveLength(6);
  ready = waitDecoders(6);
  feeds[5]!.controller.enqueue(description);
  await ready;
  outputs[4]!(primary); // The old elected display cannot paint after handoff.
  expect(present).toHaveBeenCalledTimes(painted + 1);
  outputs[5]!(frame);
  expect(present).toHaveBeenCalledTimes(painted + 2);
  expect(present.mock.lastCall?.[0]).toBe(frame);
  config(3, "portrait", true);
  expect(feeds).toHaveLength(6); // Duplicate native readback does not reconnect.
  setSupported(false);
  client.setDuoPanels(null);
  client.setDuoPanels({ cover: { present: cover }, inner: { present: inner } });
  expect(feeds[7]!.url).not.toContain("/panel/");
  const panelFailure = waitPanelFailure();
  feeds[7]!.controller.enqueue(description);
  await panelFailure;
  expect(onDuoUnavailable.mock.lastCall?.[0]).toContain("cannot decode");
  config(3);
  const fixedPanelFailure = waitPanelFailure();
  client.setDuoPanels({ cover: { present: cover }, inner: { present: inner } });
  feeds[8]!.controller.enqueue(description);
  await fixedPanelFailure;
  expect(onDuoUnavailable).toHaveBeenCalled();
  expect(onStatus.mock.calls.some(([status]) => status === "error")).toBe(false);
  setPanelHttpStatus(404);
  const missingPanel = waitPanelFailure();
  client.setDuoPanels({ cover: { present: cover }, inner: { present: inner } });
  await missingPanel;
  expect(onDuoUnavailable.mock.lastCall?.[0]).toContain("does not provide fixed Duo");
  expect(Socket.instances).toHaveLength(1);
  client.stop();
  expect(feeds[3]!.signal.aborted).toBe(true);
  expect(ws.close).toHaveBeenCalledOnce();
  expect(frame.close).toHaveBeenCalledTimes(9);
  const paintsBeforeStop = present.mock.calls.length;
  const statusesBeforeStop = onStatus.mock.calls.length;
  outputs[5]!(frame);
  expect(present).toHaveBeenCalledTimes(paintsBeforeStop);
  expect(onStatus).toHaveBeenCalledTimes(statusesBeforeStop);
  client.start();
  outputs[5]!(frame);
  expect(present).toHaveBeenCalledTimes(paintsBeforeStop);
  expect(onStatus).toHaveBeenLastCalledWith("connecting", undefined);
  client.stop();
});

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
