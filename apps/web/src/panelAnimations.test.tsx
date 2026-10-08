import { act, useLayoutEffect, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
  usePanelPresence,
} from "./panelAnimations";

vi.mock("./hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { panelAnimationDurationMs: number }) => unknown) =>
    select({ panelAnimationDurationMs: 200 }),
}));
vi.mock("./hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

let renderer: ReactTestRenderer | null = null;
let pendingFrames: FrameRequestCallback[] = [];
let observed: boolean[] = [];

function SuppressionProbe({ navigationKey }: { navigationKey: string }) {
  const suppressed = usePanelNavigationSuppression(navigationKey);
  useLayoutEffect(() => {
    observed.push(suppressed);
  }, [suppressed]);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  pendingFrames = [];
  observed = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    }),
    cancelAnimationFrame: vi.fn(),
    setTimeout,
    clearTimeout,
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function paintPendingFrame() {
  const callback = pendingFrames.shift();
  await act(() => callback?.(0));
}

describe("usePanelNavigationSuppression", () => {
  it("suppresses initial and navigated panel state until each route has painted", async () => {
    await act(() => {
      renderer = create(<SuppressionProbe navigationKey="/thread/one" />);
    });
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);

    await act(() => {
      renderer?.update(<SuppressionProbe navigationKey="/thread/two" />);
    });
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);
  });
});

it("applies route suppression to its own closing panels without reopening them on release", async () => {
  let closePanel: () => void = () => {};
  function PanelProbe() {
    const [open, setOpen] = useState(true);
    const { active, durationMs } = usePanelAnimationSettings();
    const panel = usePanelPresence(open, true, active, "thread-one", durationMs);
    useLayoutEffect(() => {
      closePanel = () => setOpen(false);
      observed.push(panel.present);
    }, [panel.present]);
    return null;
  }

  await act(() => {
    renderer = create(
      <PanelAnimationSuppressionProvider value={false}>
        <PanelProbe />
      </PanelAnimationSuppressionProvider>,
    );
  });
  await act(() => closePanel());
  expect(observed.at(-1)).toBe(true);

  await act(() => {
    renderer?.update(
      <PanelAnimationSuppressionProvider value={true}>
        <PanelProbe />
      </PanelAnimationSuppressionProvider>,
    );
  });
  expect(observed.at(-1)).toBe(false);

  await act(() => {
    renderer?.update(
      <PanelAnimationSuppressionProvider value={false}>
        <PanelProbe />
      </PanelAnimationSuppressionProvider>,
    );
  });
  expect(observed.at(-1)).toBe(false);
});
