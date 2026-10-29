// @vitest-environment jsdom
import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ChatViewActivityContext } from "@t3tools/web/src/components/chatViewActivity";
import { DeferredChatContent } from "@t3tools/web/src/components/DeferredChatContent";

import { createLivePaneUpdates, LivePaneUpdatesContext, useLivePaneWarm } from "./livePaneUpdates";
import { usePaneActivity } from "./paneActivity";

const positions = Array.from({ length: 12 }, (_, slot) => ({
  paneId: `pane-${slot}`,
  plane: 0,
  slot,
}));
const renders = new Map<string, number>();
let root: Root;
let host: HTMLDivElement;
let updates: ReturnType<typeof createLivePaneUpdates>;

function Transcript({ paneId, version }: { paneId: string; version: number }) {
  useLayoutEffect(() => {
    renders.set(paneId, (renders.get(paneId) ?? 0) + 1);
  });
  return <div data-transcript={paneId}>{version}</div>;
}

function Pane({
  paneId,
  version,
  visible,
  focused = false,
}: {
  paneId: string;
  version: number;
  visible: boolean;
  focused?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const warm = useLivePaneWarm(paneId, visible, focused);
  const activity = usePaneActivity(focused, visible, element, warm);
  return (
    <div ref={element} data-pane={paneId} data-visible={visible}>
      <input aria-label={`Draft ${paneId}`} />
      <ChatViewActivityContext value={activity}>
        <DeferredChatContent>
          <Transcript paneId={paneId} version={version} />
        </DeferredChatContent>
      </ChatViewActivityContext>
    </div>
  );
}

async function render(version: number, visible = "pane-0", focused = "pane-0") {
  await act(() =>
    root.render(
      <LivePaneUpdatesContext value={updates}>
        {positions.map(({ paneId }) => (
          <Pane
            key={paneId}
            paneId={paneId}
            version={version}
            visible={visible === paneId}
            focused={focused === paneId}
          />
        ))}
      </LivePaneUpdatesContext>,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  renders.clear();
  updates = createLivePaneUpdates(positions, "pane-0");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("coalesces distant transcript updates and catches up a neighbour without remounting", async () => {
  await render(0);
  const editor = host.querySelector<HTMLInputElement>('[aria-label="Draft pane-8"]')!;
  editor.value = "unfinished draft";
  const transcript = host.querySelector<HTMLElement>('[data-transcript="pane-8"]')!;
  transcript.scrollTop = 120;
  const initialRenders = renders.get("pane-8");
  for (let version = 1; version <= 20; version++) await render(version);
  expect(renders.get("pane-8")).toBe(initialRenders);
  expect(transcript.textContent).toBe("0");
  expect(host.querySelector('[data-transcript="pane-2"]')?.textContent).toBe("20");

  await act(() => updates.setFocus("pane-6"));
  expect(host.querySelector('[data-pane="pane-8"]')?.getAttribute("data-visible")).toBe("false");
  expect(transcript.textContent).toBe("20");
  expect(renders.get("pane-8")).toBe(initialRenders! + 1);
  expect(host.querySelector('[data-transcript="pane-8"]')).toBe(transcript);
  expect(transcript.scrollTop).toBe(120);
  expect(host.querySelector('[aria-label="Draft pane-8"]')).toBe(editor);
  expect(editor.value).toBe("unfinished draft");
});

it("updates visible overview panes and direct focus jumps even outside the warm neighbourhood", async () => {
  await render(0);
  await render(1, "pane-11", "pane-10");
  expect(host.querySelector('[data-transcript="pane-11"]')?.textContent).toBe("1");
  expect(host.querySelector('[data-transcript="pane-10"]')?.textContent).toBe("1");
  expect(host.querySelector('[data-transcript="pane-8"]')?.textContent).toBe("0");
});

it("updates the warm neighbourhood after layout changes and does not notify unchanged panes", () => {
  const nearby = vi.fn();
  const distant = vi.fn();
  const unsubscribe = updates.subscribe("pane-8", distant);
  updates.subscribe("pane-1", nearby);
  updates.setFocus("pane-1");
  expect(nearby).not.toHaveBeenCalled();
  expect(distant).not.toHaveBeenCalled();
  updates.setPanes(
    positions.map((pane) => (pane.paneId === "pane-8" ? { ...pane, slot: 2, plane: 1 } : pane)),
  );
  expect(distant).toHaveBeenCalledTimes(1);
  expect(updates.isWarm("pane-8")).toBe(true);
  unsubscribe();
  updates.setFocus("pane-11");
  expect(distant).toHaveBeenCalledTimes(1);
});

it("keeps ordinary chat transcripts live without an opt-in activity policy", async () => {
  await act(() =>
    root.render(
      <DeferredChatContent>
        <Transcript paneId="ordinary" version={1} />
      </DeferredChatContent>,
    ),
  );
  const transcript = host.querySelector('[data-transcript="ordinary"]');
  await act(() =>
    root.render(
      <DeferredChatContent>
        <Transcript paneId="ordinary" version={2} />
      </DeferredChatContent>,
    ),
  );
  expect(host.querySelector('[data-transcript="ordinary"]')).toBe(transcript);
  expect(transcript?.textContent).toBe("2");
});
