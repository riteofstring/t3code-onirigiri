// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useDelayedStatus } from "../hooks/useDelayedStatus";
import type { ThreadSyncPhase } from "../threadSync";
import {
  ChatViewContentReadyContext,
  useChatViewContentReady,
  useComposerSyncPhase,
} from "./chatViewContentReady";

let root: Root;
let container: HTMLDivElement;
let hostedRenders: number;
let ordinaryRenders: number;

function Content({
  threadKey,
  checkoutReady,
  phase,
  unavailable,
}: {
  threadKey: string;
  checkoutReady: boolean;
  phase: ThreadSyncPhase | null;
  unavailable?: boolean;
}) {
  hostedRenders++;
  const onReady = useChatViewContentReady(threadKey, checkoutReady, unavailable);
  const shown = useComposerSyncPhase(threadKey, phase, onReady);
  return <span data-status="hostable">{shown ?? "Ready"}</span>;
}

function Host(props: Parameters<typeof Content>[0]) {
  const [ready, setReady] = useState(false);
  return (
    <ChatViewContentReadyContext value={setReady}>
      <div data-view={props.threadKey} aria-busy={!ready}>
        <Content {...props} />
      </div>
    </ChatViewContentReadyContext>
  );
}

function OrdinaryStatus({ phase }: { phase: ThreadSyncPhase | null }) {
  ordinaryRenders++;
  const shown = useDelayedStatus("ordinary", phase);
  return <span data-status="ordinary">{shown ?? "Ready"}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  hostedRenders = 0;
  ordinaryRenders = 0;
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("preserves ordinary status timing and render work without a readiness host", async () => {
  const render = (phase: ThreadSyncPhase | null) =>
    act(() =>
      root.render(
        <>
          <Content threadKey="ordinary" checkoutReady phase={phase} />
          <OrdinaryStatus phase={phase} />
        </>,
      ),
    );
  const statuses = () =>
    [...container.querySelectorAll("[data-status]")].map((element) => element.textContent);

  await render("syncing");
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(statuses()).toEqual(["syncing", "syncing"]);
  await render(null);
  await act(() => vi.advanceTimersByTimeAsync(399));
  expect(statuses()).toEqual(["syncing", "syncing"]);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(statuses()).toEqual(["Ready", "Ready"]);
  expect(hostedRenders).toBe(ordinaryRenders);
});

it("does not reuse the previous thread's preparation when a view changes threads", async () => {
  await act(() => root.render(<Host threadKey="one" checkoutReady phase={null} />));
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  await act(() => root.render(<Host threadKey="two" checkoutReady={false} phase={null} />));
  expect(container.querySelector('[aria-busy="false"]')).toBeNull();
  await act(() => root.render(<Host threadKey="two" checkoutReady phase={null} />));
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
});

it("keeps readiness local to each retained view", async () => {
  await act(() =>
    root.render(
      <>
        <Host threadKey="one" checkoutReady={false} phase={null} />
        <Host threadKey="two" checkoutReady phase={null} />
      </>,
    ),
  );
  expect(container.querySelector('[data-view="one"]')?.getAttribute("aria-busy")).toBe("true");
  expect(container.querySelector('[data-view="two"]')?.getAttribute("aria-busy")).toBe("false");
});

it("allows unavailable-environment UI without treating it as a resolved checkout", async () => {
  await act(() =>
    root.render(<Host threadKey="one" checkoutReady={false} phase={null} unavailable />),
  );
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  await act(() => root.render(<Host threadKey="one" checkoutReady={false} phase={null} />));
  expect(container.querySelector('[aria-busy="false"]')).toBeNull();
  await act(() => root.render(<Host threadKey="one" checkoutReady phase={null} />));
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
});
