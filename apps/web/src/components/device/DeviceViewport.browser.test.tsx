import type { DeviceStreamClient, DuoPanelSinks } from "@t3tools/client-runtime/device/stream";
import { IOS_PHONE_SHAPE } from "@t3tools/client-runtime/device/shape-profile";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const viewers = vi.hoisted(() => ({ phone: vi.fn(), duo: vi.fn() }));
vi.mock("@t3tools/client-runtime/device/phone-viewer", () => ({
  createPhoneViewer: viewers.phone,
}));
vi.mock("@t3tools/client-runtime/device/duo-viewer", () => ({ createDuoViewer: viewers.duo }));
import { DeviceDuoViewport } from "./DeviceDuoViewport";
import { DevicePhoneViewport } from "./DevicePhoneViewport";

function fakeViewer() {
  return {
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
}

function fixture(kind: "phone" | "duo") {
  const viewer = fakeViewer();
  viewers[kind].mockReset().mockReturnValue(viewer);
  const client = {
    sendTouch: vi.fn(),
    sendRawTouch: vi.fn(),
    controlDuo: vi.fn(),
    setDuoPanels: vi.fn<(panels: DuoPanelSinks | null) => void>(),
  } as unknown as DeviceStreamClient;
  const shared = {
    source: document.createElement("canvas"),
    client,
    onUnavailable: vi.fn(),
    onFrameListener: vi.fn(),
    onResetReady: vi.fn(),
    onInputCancel: vi.fn(),
  };
  const view = (active: boolean, screenId = 1) => {
    const screen = {
      width: 400,
      height: 800,
      orientation: "portrait" as const,
      screenId,
      hingeAngle: 0,
      supportsHingeAngle: true,
    };
    // The pane is laid out at 400x800 and painted at half size, as in a zoomed-out workspace.
    return (
      <div style={{ transform: "scale(0.5)", transformOrigin: "0 0" }}>
        <div style={{ position: "relative", width: 400, height: 800 }}>
          {kind === "phone" ? (
            <DevicePhoneViewport
              {...shared}
              active={active}
              screen={screen}
              model={null}
              accessory={null}
              foldAngle={null}
              profile={IOS_PHONE_SHAPE}
            />
          ) : (
            <DeviceDuoViewport
              {...shared}
              active={active}
              screen={screen}
              model={{ id: "iphone-duo", url: "/duo.glb" }}
              hingePreview={null}
              onControlRejectedListener={vi.fn()}
            />
          )}
        </div>
      </div>
    );
  };
  return { viewer, client, view };
}

it.each(["phone", "duo"] as const)(
  "%s keeps one viewer across hiding and sizes it in layout pixels",
  async (kind) => {
    const { viewer, view } = fixture(kind);
    await using screen = await render(view(true), { router: false });
    await expect.poll(() => viewer.resize.mock.calls.length).toBeGreaterThan(0);
    expect(viewer.resize).toHaveBeenLastCalledWith(400, 800, window.devicePixelRatio);
    expect(viewer.setActive).toHaveBeenLastCalledWith(true);

    await screen.rerender(view(false));
    expect(viewer.setActive).toHaveBeenLastCalledWith(false);
    expect(screen.container.querySelector("[inert]")).not.toBeNull();
    viewer.resize.mockClear();

    await screen.rerender(view(true));
    expect(viewer.setActive).toHaveBeenLastCalledWith(true);
    expect(viewer.resize).toHaveBeenCalledWith(400, 800, window.devicePixelRatio);
    expect(screen.container.querySelector("[inert]")).toBeNull();
    expect(viewers[kind]).toHaveBeenCalledOnce();
    expect(viewer.dispose).not.toHaveBeenCalled();

    await screen.unmount();
    expect(viewer.dispose).toHaveBeenCalledOnce();
  },
);

it("offers a retained Duo viewer's panel sinks again once the restarted stream reports a screen", async () => {
  const { client, view } = fixture("duo");
  await using screen = await render(view(true), { router: false });
  const setDuoPanels = vi.mocked(client.setDuoPanels);
  await expect.poll(() => setDuoPanels.mock.calls.length).toBeGreaterThan(0);
  const sinks = setDuoPanels.mock.calls[0]![0];
  expect(sinks).not.toBeNull();

  await screen.rerender(view(false));
  setDuoPanels.mockClear();
  await screen.rerender(view(true, 3));
  expect(setDuoPanels).toHaveBeenLastCalledWith(sinks);

  await screen.unmount();
  expect(setDuoPanels).toHaveBeenLastCalledWith(null);
});
