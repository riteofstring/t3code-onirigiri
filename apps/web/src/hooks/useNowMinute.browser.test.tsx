import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import type { ChatViewActivity } from "../components/chatViewActivity";
import { useNowMinute } from "./useNowMinute";

function createActivity(initial: boolean) {
  let active = initial;
  const listeners = new Set<() => void>();
  return {
    isActive: () => active,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (value: boolean) => {
      active = value;
      for (const listener of listeners) listener();
    },
  };
}

function Clock({ id, activity }: { id: string; activity?: ChatViewActivity }) {
  return <output data-clock={id}>{useNowMinute(activity)}</output>;
}

it("holds an inactive view's clock through ticks and renders, then catches up on activation", async () => {
  // The first render reads the current minute.
  using _timers = fakeTimers({ now: new Date("2026-10-23T12:00:30.000Z") });
  const activity = createActivity(false);
  const tree = () => (
    <>
      <Clock id="pane" activity={activity} />
      <Clock id="sidebar" />
    </>
  );
  // A bare hook probe; nothing here navigates.
  await using screen = await render(tree(), { router: false });
  const shown = (id: string) => screen.container.querySelector(`[data-clock="${id}"]`)?.textContent;
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  await advance(150_000);
  expect(shown("sidebar")).toBe("2026-10-23T12:03");
  expect(shown("pane")).toBe("2026-10-23T12:00");
  await screen.rerender(tree());
  expect(shown("pane")).toBe("2026-10-23T12:00");
  await act(() => activity.set(true));
  expect(shown("pane")).toBe("2026-10-23T12:03");
  await advance(60_000);
  expect(shown("pane")).toBe("2026-10-23T12:04");
  await act(() => activity.set(false));
  await advance(60_000);
  expect(shown("sidebar")).toBe("2026-10-23T12:05");
  expect(shown("pane")).toBe("2026-10-23T12:04");
});
