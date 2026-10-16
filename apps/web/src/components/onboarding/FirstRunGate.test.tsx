import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { FirstRunGate } from "./FirstRunGate";

const state = vi.hoisted(() => ({
  catalogReady: false,
  getLocalEnvironmentEnabled: vi.fn(() => false),
  navigate: vi.fn(async () => {}),
  completeOnboarding: vi.fn(async () => {}),
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useLocation: () => "/",
}));
vi.mock("../../hooks/useSettings", () => ({
  ensureClientSettingsHydrated: async () => {},
  useClientSettings: () => null,
  useClientSettingsHydrationStatus: () => "ready",
}));
vi.mock("../../onboarding/firstRun", () => ({
  useCompleteOnboarding: () => state.completeOnboarding,
}));
vi.mock("../../state/entities", () => ({
  useAllEnvironmentShellsBootstrapped: () => true,
  useProjects: () => [],
  useThreadShells: () => [],
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: [], isReady: state.catalogReady }),
}));
vi.mock("../../state/projects", () => ({ environmentProjects: { projectsAtom: {} } }));
vi.mock("../../state/server", () => ({
  primaryServerConfigAtom: {},
  primaryServerWelcomeAtom: {},
}));
vi.mock("../../state/shell", () => ({ environmentShell: {} }));
vi.mock("../../state/threads", () => ({ environmentThreadShells: { threadShellsAtom: {} } }));
vi.mock("../ui/button", () => ({ Button: () => null }));
vi.mock("~/components/ui/refresh-icon", () => ({ RefreshIcon: () => null }));

let renderer: ReactTestRenderer | undefined;

async function render(revision = 0) {
  await act(() => {
    const element = (
      <FirstRunGate enabled hostedStatic>
        <span>{revision}</span>
      </FirstRunGate>
    );
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  state.catalogReady = false;
  state.getLocalEnvironmentEnabled.mockReset().mockReturnValue(false);
  state.navigate.mockClear();
  state.completeOnboarding.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    desktopBridge: { getLocalEnvironmentEnabled: state.getLocalEnvironmentEnabled },
    setTimeout,
    clearTimeout,
  });
});

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps remote startup responsive without another synchronous settings read on updates", async () => {
  await render();
  expect(renderer!.toJSON()).toBeNull();

  state.catalogReady = true;
  await render(1);
  expect(renderer!.root.findByType("span").children).toEqual(["1"]);
  for (let revision = 2; revision <= 5; revision++) await render(revision);

  expect(renderer!.root.findByType("span").children).toEqual(["5"]);
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.completeOnboarding).toHaveBeenCalled();
  expect(state.getLocalEnvironmentEnabled).toHaveBeenCalledTimes(1);
});

it("reads the restarted desktop mode on a new mount and preserves onboarding", async () => {
  state.catalogReady = true;
  state.getLocalEnvironmentEnabled.mockReturnValue(true);
  await render();
  expect(renderer!.toJSON()).toBeNull();
  expect(state.navigate).toHaveBeenCalledWith({ to: "/welcome", replace: true });

  await act(() => renderer!.unmount());
  renderer = undefined;
  state.getLocalEnvironmentEnabled.mockReturnValue(false);
  state.navigate.mockClear();
  await render(1);
  expect(renderer!.root.findByType("span").children).toEqual(["1"]);
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.getLocalEnvironmentEnabled).toHaveBeenCalledTimes(2);
});

it("preserves hosted browser onboarding without a desktop bridge", async () => {
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  state.catalogReady = true;
  await render();
  expect(renderer!.toJSON()).toBeNull();
  expect(state.navigate).toHaveBeenCalledWith({ to: "/welcome", replace: true });
  expect(state.getLocalEnvironmentEnabled).not.toHaveBeenCalled();
});
