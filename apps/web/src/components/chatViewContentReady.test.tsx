// @vitest-environment jsdom
import { act, StrictMode, Suspense, use, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useDelayedStatus } from "../hooks/useDelayedStatus";
import type { ThreadSyncPhase } from "../threadSync";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import {
  ChatViewContentReadyProvider,
  ChatViewPendingContent,
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
  timelineReady = true,
  phase,
  unavailable,
}: {
  threadKey: string;
  checkoutReady: boolean;
  timelineReady?: boolean;
  phase: ThreadSyncPhase | null;
  unavailable?: boolean;
}) {
  hostedRenders++;
  const onReady = useChatViewContentReady(threadKey, checkoutReady, timelineReady, unavailable);
  const shown = useComposerSyncPhase(threadKey, phase, onReady);
  return <span data-status="hostable">{shown ?? "Ready"}</span>;
}

function Host({ children, ...props }: Parameters<typeof Content>[0] & { children?: ReactNode }) {
  const [ready, setReady] = useState(false);
  return (
    <ChatViewContentReadyProvider onReadyChange={setReady}>
      <div data-view={props.threadKey} aria-busy={!ready}>
        <Content {...props} />
        {children}
      </div>
    </ChatViewContentReadyProvider>
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

it("keeps the visual cover until both the timeline and composer are ready", async () => {
  const render = (timelineReady: boolean, phase: ThreadSyncPhase | null) =>
    act(() =>
      root.render(
        <Host threadKey="one" checkoutReady timelineReady={timelineReady} phase={phase} />,
      ),
    );
  await render(false, null);
  expect(container.querySelector('[aria-busy="false"]')).toBeNull();
  await render(true, null);
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  await render(true, "syncing");
  expect(container.querySelector('[aria-busy="false"]')).toBeNull();
  await render(true, null);
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
});

it("releases a provider subagent view after its timeline settles without a composer", async () => {
  function Subagent({ timelineReady }: { timelineReady: boolean }) {
    useChatViewContentReady("subagent", true, timelineReady, false, false);
    return <p>Provider subagent activity</p>;
  }
  function SubagentHost({ timelineReady }: { timelineReady: boolean }) {
    const [ready, setReady] = useState(false);
    return (
      <ChatViewContentReadyProvider onReadyChange={setReady}>
        <div aria-busy={!ready}>
          <Subagent timelineReady={timelineReady} />
        </div>
      </ChatViewContentReadyProvider>
    );
  }
  await act(() => root.render(<SubagentHost timelineReady={false} />));
  expect(container.querySelector('[aria-busy="false"]')).toBeNull();
  await act(() => root.render(<SubagentHost timelineReady />));
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  expect(container.textContent).toBe("Provider subagent activity");
});

it.each([false, true])(
  "keeps suspended content covered with pending blocks first: %s",
  async (pendingFirst) => {
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    const third = Promise.withResolvers<string>();
    const blocks = { first, second, third };
    function Block({ result }: { result: Promise<string> }) {
      return <pre>{use(result)}</pre>;
    }
    function SuspendedHost({ ids }: { ids: (keyof typeof blocks)[] }) {
      const [ready, setReady] = useState(false);
      const content = <Content threadKey="one" checkoutReady phase={null} />;
      return (
        <ChatViewContentReadyProvider onReadyChange={setReady}>
          <div aria-busy={!ready}>
            {pendingFirst ? null : content}
            {ids.map((id) => (
              <RenderErrorBoundary key={id} fallback={<pre>Plain code after failure</pre>}>
                <Suspense fallback={<ChatViewPendingContent />}>
                  <Block result={blocks[id].promise} />
                </Suspense>
              </RenderErrorBoundary>
            ))}
            {pendingFirst ? content : null}
          </div>
        </ChatViewContentReadyProvider>
      );
    }
    const render = (ids: (keyof typeof blocks)[]) =>
      act(() =>
        root.render(
          <StrictMode>
            <SuspendedHost ids={ids} />
          </StrictMode>,
        ),
      );
    await render(["first", "second"]);
    expect(container.querySelector('[aria-busy="false"]')).toBeNull();
    await act(() => first.resolve("First code block"));
    expect(container.textContent).toContain("First code block");
    expect(container.querySelector('[aria-busy="false"]')).toBeNull();
    await act(() => second.resolve("Second code block"));
    expect(container.textContent).toContain("Second code block");
    expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
    await render(["first", "second", "third"]);
    expect(container.querySelector('[aria-busy="false"]')).toBeNull();
    await render(["first", "second"]);
    expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
    await render(["first", "second", "third"]);
    expect(container.querySelector('[aria-busy="false"]')).toBeNull();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(() => third.reject(new Error("Highlight unavailable")));
      expect(container.textContent).toContain("Plain code after failure");
      expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
    } finally {
      errorLog.mockRestore();
    }
  },
);

it("allows unavailable-environment UI without treating it as a resolved checkout", async () => {
  await act(() =>
    root.render(
      <Host threadKey="one" checkoutReady={false} timelineReady={false} phase={null} unavailable />,
    ),
  );
  expect(container.querySelector('[aria-busy="false"]')).toBeNull();
  await act(() =>
    root.render(<Host threadKey="one" checkoutReady={false} phase={null} unavailable />),
  );
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  await act(() => root.render(<Host threadKey="one" checkoutReady={false} phase={null} />));
  expect(container.querySelector('[aria-busy="false"]')).toBeNull();
  await act(() => root.render(<Host threadKey="one" checkoutReady phase={null} />));
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
});
