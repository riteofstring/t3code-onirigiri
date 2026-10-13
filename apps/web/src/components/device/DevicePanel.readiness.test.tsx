// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ThreadId,
  type DeviceServiceState,
  type DeviceSummary,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const commands = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  configure: vi.fn(),
}));

vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("~/state/session", () => ({ environmentSession: {} }));
vi.mock("@t3tools/client-runtime/state/device", () => ({
  createDeviceEnvironmentAtoms: () => ({
    ...commands,
    state: ({ environmentId }: { environmentId: EnvironmentId }) => stateAtoms(environmentId),
  }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("./DeviceWorkspace", () => ({
  DeviceWorkspace: ({ device }: { device: DeviceSummary }) => (
    <input aria-label={`Device workspace ${device.name}`} defaultValue="" />
  ),
}));

import { deviceSurface } from "~/rightPanelStore";
import { DevicePanel } from "./DevicePanel";

const stateAtoms = Atom.family((_environmentId: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<DeviceServiceState, Error>>(AsyncResult.initial(true)),
);
const environmentId = EnvironmentId.make("device-panel-readiness");
const threadId = ThreadId.make("device-panel-readiness-thread");
const device: DeviceSummary = {
  hostId: "local",
  id: "owned-simulator",
  platform: "ios",
  name: "Owned simulator",
  version: "iOS 18",
  booted: true,
  physical: false,
};
const configured: DeviceServiceState = {
  hosts: [
    {
      id: "local",
      kind: "local",
      label: "Local host",
      platforms: [{ platform: "ios", available: true }],
      hubInstalled: true,
      agentDeviceInstalled: false,
    },
  ],
  hostStatus: "ready",
  hostStatuses: { local: { status: "ready" } },
  devices: [device],
  sessions: [],
  onboardingCompleted: true,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 1,
};

let registry: AtomRegistry.AtomRegistry;
let host: HTMLDivElement;
let root: Root;
let dismissSetup: () => void;

async function show(
  surface: ComponentProps<typeof DevicePanel>["surface"] = { id: "device", kind: "device" },
) {
  await act(() => {
    root.render(
      <RegistryContext.Provider value={registry}>
        <DevicePanel
          mode="embedded"
          threadRef={{ environmentId, threadId }}
          surface={surface}
          visible
          onDismissSetup={dismissSetup}
        />
      </RegistryContext.Provider>,
    );
  });
}

async function publish(result: AsyncResult.AsyncResult<DeviceServiceState, Error>) {
  await act(() => {
    registry.set(stateAtoms(environmentId), result);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.clearAllMocks();
  commands.list.mockResolvedValue(undefined);
  registry = AtomRegistry.make();
  dismissSetup = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  registry.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for the environment before discovering devices without showing setup", async () => {
  await show();
  expect(host.textContent).toContain("Finding devices…");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(commands.list).not.toHaveBeenCalled();

  await publish(AsyncResult.failure(Cause.fail(new Error("Offline"))));
  expect(host.textContent).toContain("Finding devices…");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(commands.list).not.toHaveBeenCalled();

  await publish(AsyncResult.success(configured));
  expect(host.querySelector('[aria-label="Open Owned simulator"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Finding devices…");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(commands.list).toHaveBeenCalledExactlyOnceWith({ environmentId, input: {} });
  expect(commands.configure).not.toHaveBeenCalled();
});

it("opens dismissible setup only after the environment reports that devices are disabled", async () => {
  await show();
  expect(host.textContent).toContain("Finding devices…");
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  await publish(
    AsyncResult.success({
      ...configured,
      hostStatus: "disabled",
      hostStatuses: {},
      onboardingCompleted: false,
      revision: 2,
    }),
  );
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Set up devices");
  expect(dialog?.querySelector('[aria-label="Enable device hub"]')).not.toBeNull();
  expect(commands.list).not.toHaveBeenCalled();
  expect(commands.configure).not.toHaveBeenCalled();
  const cancel = Array.from(dialog!.querySelectorAll("button")).find(
    (button) => button.textContent === "Cancel",
  );
  expect(cancel).toBeDefined();
  await act(() => cancel!.click());
  expect(dismissSetup).toHaveBeenCalledTimes(1);
});

it("keeps the active workspace mounted through refresh, transient failure, and recovery", async () => {
  const connected: DeviceServiceState = {
    ...configured,
    sessions: [
      {
        threadId,
        hostId: device.hostId,
        deviceId: device.id,
        platform: device.platform,
        openedAt: "2026-10-13T00:00:00.000Z",
      },
    ],
  };
  const success = AsyncResult.success<DeviceServiceState, Error>(connected);
  registry.set(stateAtoms(environmentId), success);
  await show(
    deviceSurface({
      hostId: device.hostId,
      deviceId: device.id,
      platform: device.platform,
      name: device.name,
    }),
  );
  const selector = '[aria-label="Device workspace Owned simulator"]';
  const workspace = host.querySelector<HTMLInputElement>(selector);
  expect(workspace).not.toBeNull();
  workspace!.value = "Retained workspace state";

  for (const result of [
    AsyncResult.waiting(success),
    AsyncResult.failure(Cause.fail(new Error("Disconnected")), {
      previousSuccess: Option.some(success),
    }),
    AsyncResult.success({ ...connected, revision: 2 }),
  ]) {
    await publish(result);
    expect(host.querySelector(selector)).toBe(workspace);
    expect(workspace!.value).toBe("Retained workspace state");
    expect(host.textContent).not.toContain("Finding devices…");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }
  expect(commands.list).toHaveBeenCalledTimes(1);
  expect(commands.configure).not.toHaveBeenCalled();
});
