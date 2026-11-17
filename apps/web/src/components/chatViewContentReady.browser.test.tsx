import { StrictMode, Suspense, use, useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import type { ThreadSyncPhase } from "../threadSync";
import { ChatViewHostContext } from "./chatViewHost";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import {
  ChatViewContentReadyProvider,
  ChatViewPendingContent,
  useChatViewContentReady,
  useComposerSyncPhase,
} from "./chatViewContentReady";

function Content(props: {
  threadKey: string;
  checkoutReady: boolean;
  timelineReady?: boolean;
  phase: ThreadSyncPhase | null;
}) {
  const onReady = useChatViewContentReady(
    props.threadKey,
    props.checkoutReady,
    props.timelineReady ?? true,
  );
  const shown = useComposerSyncPhase(props.threadKey, props.phase, onReady);
  return <span>{shown ?? "Ready"}</span>;
}

function Host(props: Parameters<typeof Content>[0]) {
  const [ready, setReady] = useState(false);
  return (
    <ChatViewContentReadyProvider onReadyChange={setReady}>
      <div data-testid="view" aria-busy={!ready}>
        <Content {...props} />
      </div>
    </ChatViewContentReadyProvider>
  );
}

const busy = (container: HTMLElement) =>
  container.querySelector('[data-testid="view"]')?.getAttribute("aria-busy");

it("keeps the visual cover until both the timeline and composer are ready", async () => {
  // The composer sync phase schedules its delayed status on the first render.
  using _timers = fakeTimers();
  const host = (timelineReady: boolean, phase: ThreadSyncPhase | null) => (
    <Host threadKey="one" checkoutReady timelineReady={timelineReady} phase={phase} />
  );
  // Readiness hooks only; nothing here navigates.
  await using screen = await render(host(false, null), { router: false });
  expect(busy(screen.container)).toBe("true");
  await screen.rerender(host(true, null));
  expect(busy(screen.container)).toBe("false");
  await screen.rerender(host(true, "syncing"));
  expect(busy(screen.container)).toBe("true");
  await screen.rerender(host(true, null));
  expect(busy(screen.container)).toBe("false");
});

it("does not reuse the previous thread's preparation when a view changes threads", async () => {
  using _timers = fakeTimers();
  // Readiness hooks only; nothing here navigates.
  await using screen = await render(<Host threadKey="one" checkoutReady phase={null} />, {
    router: false,
  });
  expect(busy(screen.container)).toBe("false");
  await screen.rerender(<Host threadKey="two" checkoutReady={false} phase={null} />);
  expect(busy(screen.container)).toBe("true");
  await screen.rerender(<Host threadKey="two" checkoutReady phase={null} />);
  expect(busy(screen.container)).toBe("false");
});

it.each([false, true])(
  "keeps suspended content covered with pending blocks first: %s",
  async (pendingFirst) => {
    const block = () => {
      let resolve!: (value: string) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<string>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      return { promise, resolve, reject };
    };
    const blocks = { first: block(), second: block(), third: block() };
    function Block({ result }: { result: Promise<string> }) {
      return <pre>{use(result)}</pre>;
    }
    function SuspendedHost({ ids }: { ids: (keyof typeof blocks)[] }) {
      const [ready, setReady] = useState(false);
      const content = <Content threadKey="one" checkoutReady phase={null} />;
      return (
        <ChatViewContentReadyProvider onReadyChange={setReady}>
          <div data-testid="view" aria-busy={!ready}>
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
    const tree = (ids: (keyof typeof blocks)[]) => (
      <StrictMode>
        <SuspendedHost ids={ids} />
      </StrictMode>
    );
    using _timers = fakeTimers();
    // Readiness hooks only; nothing here navigates.
    await using screen = await render(tree(["first", "second"]), { router: false });
    expect(busy(screen.container)).toBe("true");
    await act(() => blocks.first.resolve("First code block"));
    await expect.element(screen.getByText("First code block")).toBeInTheDocument();
    expect(busy(screen.container)).toBe("true");
    await act(() => blocks.second.resolve("Second code block"));
    await expect.element(screen.getByText("Second code block")).toBeInTheDocument();
    expect(busy(screen.container)).toBe("false");
    await screen.rerender(tree(["first", "second", "third"]));
    expect(busy(screen.container)).toBe("true");
    await screen.rerender(tree(["first", "second"]));
    expect(busy(screen.container)).toBe("false");
    await screen.rerender(tree(["first", "second", "third"]));
    expect(busy(screen.container)).toBe("true");
    using _errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(() => blocks.third.reject(new Error("Highlight unavailable")));
    await expect.element(screen.getByText("Plain code after failure")).toBeInTheDocument();
    expect(busy(screen.container)).toBe("false");
  },
);

it("reports the stock composer ready while the host defers its timeline, without reporting the complete view ready", async () => {
  const composer = vi.fn();
  const content = vi.fn();
  using _timers = fakeTimers();
  // Readiness hooks only; nothing here navigates.
  await using _screen = await render(
    <ChatViewHostContext
      value={{ deferTimeline: true, timelineFallback: null, onComposerReady: composer }}
    >
      <ChatViewContentReadyProvider onReadyChange={content}>
        <Content threadKey="input-first" checkoutReady timelineReady={false} phase={null} />
      </ChatViewContentReadyProvider>
    </ChatViewHostContext>,
    { router: false },
  );
  expect(composer).toHaveBeenLastCalledWith(true);
  expect(content).toHaveBeenLastCalledWith(false);
});
