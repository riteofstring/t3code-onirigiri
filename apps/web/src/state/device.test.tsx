import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, type DeviceServiceState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("./session", () => ({ environmentSession: {} }));
vi.mock("@t3tools/client-runtime/state/device", () => ({
  createDeviceEnvironmentAtoms: () => ({
    state: ({ environmentId }: { environmentId: EnvironmentId }) => stateAtoms(environmentId),
  }),
}));

import { useDeviceState } from "./device";

const stateAtoms = Atom.family((_environmentId: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<DeviceServiceState, Error>>(AsyncResult.initial(true)),
);
const environmentId = EnvironmentId.make("device-readiness");
const configured: DeviceServiceState = {
  hosts: [],
  hostStatus: "ready",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: true,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 1,
};

let registry: AtomRegistry.AtomRegistry;
let renderer: ReactTestRenderer | undefined;
let latest: ReturnType<typeof useDeviceState>;

function Probe({ environment }: { environment: EnvironmentId | null }) {
  const value = useDeviceState(environment);
  useLayoutEffect(() => {
    latest = value;
  }, [value]);
  return null;
}

async function show(environment: EnvironmentId | null = environmentId) {
  const view = (
    <RegistryContext.Provider value={registry}>
      <Probe environment={environment} />
    </RegistryContext.Provider>
  );
  await act(() => {
    if (renderer) renderer.update(view);
    else renderer = create(view);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});

it("does not report Device setup state as loaded before the environment has answered", async () => {
  await show();
  expect(latest.loaded).toBe(false);
  await act(() => {
    registry.set(stateAtoms(environmentId), AsyncResult.failure(Cause.fail(new Error("Offline"))));
  });
  expect(latest.loaded).toBe(false);
  await act(() => {
    registry.set(stateAtoms(environmentId), AsyncResult.success(configured));
  });
  expect(latest.loaded).toBe(true);
  expect(latest.state).toBe(configured);
  await show(EnvironmentId.make("unanswered"));
  expect(latest.loaded).toBe(false);
  await show(null);
  expect(latest.loaded).toBe(false);
});

it("retains known Device state during refresh and transient failure, and accepts recovery", async () => {
  const success = AsyncResult.success<DeviceServiceState, Error>(configured);
  registry.set(stateAtoms(environmentId), success);
  await show();
  await act(() => {
    registry.set(stateAtoms(environmentId), AsyncResult.waiting(success));
  });
  expect(latest.loaded).toBe(true);
  expect(latest.state).toBe(configured);
  await act(() => {
    registry.set(
      stateAtoms(environmentId),
      AsyncResult.failure(Cause.fail(new Error("Disconnected")), {
        previousSuccess: Option.some(success),
      }),
    );
  });
  expect(latest.loaded).toBe(true);
  expect(latest.state).toBe(configured);
  const disabled: DeviceServiceState = {
    ...configured,
    hostStatus: "disabled",
    onboardingCompleted: false,
    revision: 2,
  };
  await act(() => {
    registry.set(stateAtoms(environmentId), AsyncResult.success(disabled));
  });
  expect(latest.loaded).toBe(true);
  expect(latest.state).toBe(disabled);
});
