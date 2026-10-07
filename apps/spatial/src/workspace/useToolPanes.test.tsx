import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useToolPanes } from "./useToolPanes";

const storage = new Map<string, string>();
let hook: ReturnType<typeof useToolPanes>;
let renderer: ReactTestRenderer | undefined;

function Probe() {
  const value = useToolPanes();
  useEffect(() => {
    hook = value;
  });
  return null;
}

async function mount() {
  await act(() => {
    renderer = create(<Probe />);
  });
}

const thread = (threadId: string) => ({
  environmentId: "e" as EnvironmentId,
  threadId: threadId as ThreadId,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  storage.clear();
  vi.unstubAllGlobals();
});

it("places a new pane right after its thread or after the added pane it follows", async () => {
  await mount();
  let first = "";
  let second = "";
  let third = "";
  await act(() => {
    first = hook.addEmpty(thread("t1"), null);
  });
  await act(() => {
    second = hook.addEmpty(thread("t1"), null);
  });
  await act(() => {
    third = hook.addEmpty(thread("t1"), second);
  });
  expect(hook.toolPanes.map((pane) => pane.paneId)).toEqual([second, third, first]);
});

it("turns an empty pane into a terminal or diff and remembers it across reloads", async () => {
  await mount();
  let paneId = "";
  await act(() => {
    paneId = hook.addEmpty(thread("t1"), null);
  });
  await act(() => hook.choose(paneId, "terminal"));
  const terminal = hook.toolPanes[0]!;
  expect(terminal.kind).toBe("terminal");
  expect(terminal.terminalId).toBeTruthy();

  await act(() => renderer!.unmount());
  renderer = undefined;
  await mount();
  expect(hook.toolPanes).toEqual([terminal]);

  await act(() => hook.remove(paneId));
  expect(hook.toolPanes).toEqual([]);
});
