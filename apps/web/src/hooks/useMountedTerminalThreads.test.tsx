// @vitest-environment jsdom
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useMountedTerminalThreads } from "./useMountedTerminalThreads";

const fixture = vi.hoisted(() => ({
  refs: [] as ScopedThreadRef[],
  listeners: new Set<() => void>(),
}));
vi.mock("../state/entities", async () => {
  const { useCallback, useSyncExternalStore } = await import("react");
  const empty: ScopedThreadRef[] = [];
  return {
    useThreadRefs: (enabled = true) =>
      useSyncExternalStore(
        useCallback(
          (notify: () => void) => {
            if (!enabled) return () => {};
            fixture.listeners.add(notify);
            return () => fixture.listeners.delete(notify);
          },
          [enabled],
        ),
        () => (enabled ? fixture.refs : empty),
      ),
  };
});

const first = scopeThreadRef(EnvironmentId.make("first-environment"), ThreadId.make("thread"));
const second = scopeThreadRef(EnvironmentId.make("second-environment"), ThreadId.make("thread"));
let host: HTMLDivElement;
let root: Root;
let commits: number;

function Probe({ active, enabled }: { active: ScopedThreadRef; enabled: boolean }) {
  const mounted = useMountedTerminalThreads(scopedThreadKey(active), true, enabled);
  useLayoutEffect(() => {
    commits++;
  });
  return <output>{mounted.map(({ key }) => key).join(",")}</output>;
}

async function render(active: ScopedThreadRef, enabled = true) {
  await act(() => root.render(<Probe active={active} enabled={enabled} />));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.refs = [first, second];
  fixture.listeners.clear();
  useTerminalUiStateStore.setState({ terminalUiStateByThreadKey: {} });
  useComposerDraftStore.setState({ draftThreadsByThreadKey: {} });
  commits = 0;
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("does not mount duplicate drawers or render on unrelated terminal and draft changes in spatial mode", async () => {
  await render(first, false);
  const initial = commits;
  await act(() => {
    useTerminalUiStateStore.getState().setTerminalOpen(second, true);
    useComposerDraftStore.setState({ draftThreadsByThreadKey: {} });
    fixture.refs = [...fixture.refs];
    for (const notify of fixture.listeners) notify();
  });
  expect(host.textContent).toBe("");
  expect(commits).toBe(initial);
});

it("preserves ordinary web terminal drawers across navigation and releases a closed hidden drawer", async () => {
  useTerminalUiStateStore.getState().setTerminalOpen(first, true);
  useTerminalUiStateStore.getState().setTerminalOpen(second, true);
  await render(first);
  expect(host.textContent).toBe(scopedThreadKey(first));
  await render(second);
  expect(host.textContent?.split(",")).toEqual([scopedThreadKey(first), scopedThreadKey(second)]);
  await act(() => useTerminalUiStateStore.getState().setTerminalOpen(first, false));
  expect(host.textContent).toBe(scopedThreadKey(second));
});

it("drops retained drawers when surface navigation takes ownership and restores the active drawer when it releases ownership", async () => {
  useTerminalUiStateStore.getState().setTerminalOpen(first, true);
  await render(first);
  expect(host.textContent).toBe(scopedThreadKey(first));
  await render(first, false);
  expect(host.textContent).toBe("");
  await render(first);
  expect(host.textContent).toBe(scopedThreadKey(first));
});
