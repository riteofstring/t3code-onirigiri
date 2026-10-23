// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useChatViewActivity, type ChatViewActivity } from "../components/chatViewActivity";
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

let container: HTMLDivElement;
let root: Root;
const renders = new Map<string, number>();

function Clock({ id, activity }: { id: string; activity?: ChatViewActivity }) {
  const minute = useNowMinute(activity);
  renders.set(id, (renders.get(id) ?? 0) + 1);
  return <output data-clock={id}>{minute}</output>;
}

function OrdinaryChatClock() {
  return <Clock id="chat" activity={useChatViewActivity()} />;
}

const shown = (id: string) => container.querySelector(`[data-clock="${id}"]`)?.textContent;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-23T12:00:30.000Z");
  renders.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps ordinary consumers current with one shared timer and releases it on unmount", async () => {
  await act(() =>
    root.render(
      <>
        <Clock id="first" />
        <Clock id="second" />
        <OrdinaryChatClock />
      </>,
    ),
  );
  expect(shown("first")).toBe("2026-10-23T12:00");
  expect(vi.getTimerCount()).toBe(1);
  await advance(30_000);
  expect(shown("first")).toBe("2026-10-23T12:01");
  expect(shown("second")).toBe("2026-10-23T12:01");
  expect(shown("chat")).toBe("2026-10-23T12:01");
  expect(vi.getTimerCount()).toBe(1);
  await act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("holds an inactive view's clock through ticks and renders, then catches up on activation", async () => {
  const activity = createActivity(false);
  const render = () =>
    root.render(
      <>
        <Clock id="pane" activity={activity} />
        <Clock id="sidebar" />
      </>,
    );
  await act(render);
  const initialRenders = renders.get("pane");
  await advance(150_000);
  expect(shown("sidebar")).toBe("2026-10-23T12:03");
  expect(shown("pane")).toBe("2026-10-23T12:00");
  expect(renders.get("pane")).toBe(initialRenders);
  await act(render);
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

it("does not rerender for activity switches within the same minute or retain a replaced activity", async () => {
  const first = createActivity(true);
  const second = createActivity(false);
  await act(() => root.render(<Clock id="pane" activity={first} />));
  const initialRenders = renders.get("pane");
  await act(() => first.set(false));
  await act(() => first.set(true));
  expect(renders.get("pane")).toBe(initialRenders);
  await act(() => root.render(<Clock id="pane" activity={second} />));
  await advance(90_000);
  expect(shown("pane")).toBe("2026-10-23T12:00");
  await act(() => first.set(true));
  expect(shown("pane")).toBe("2026-10-23T12:00");
  await act(() => second.set(true));
  expect(shown("pane")).toBe("2026-10-23T12:02");
});
