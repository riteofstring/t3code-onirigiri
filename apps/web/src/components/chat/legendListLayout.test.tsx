// @vitest-environment jsdom
import { LegendList } from "@legendapp/list/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

let root: Root;
let container: HTMLDivElement;
let scale = 1;

function rowHeight(element: Element): number | null {
  const value = element.firstElementChild?.getAttribute("data-row-height");
  return value ? Number(value) : null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = getStyle(element);
    const height = rowHeight(element);
    if (height === null) return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === "width") return "420px";
        if (key === "height") return `${height}px`;
        if (key === "boxSizing") return "border-box";
        return Reflect.get(target, key);
      },
    });
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return new DOMRect(0, 0, 420 * scale, (rowHeight(this) ?? 600) * scale);
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(420);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([0.68, 1, 1.5])("measures rows in layout pixels at camera scale %s", async (zoom) => {
  scale = zoom;
  const heights = [140.25, 220.25, 100.25];
  const measured: { index: number; size: number }[] = [];
  await act(async () => {
    root.render(
      <LegendList
        data={heights}
        estimatedItemSize={90}
        estimatedListSize={{ width: 420, height: 600 }}
        recycleItems={false}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item }) => <div data-row-height={item}>Conversation row</div>}
        onItemSizeChanged={({ index, size }) => measured.push({ index, size })}
      />,
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32);
  });
  expect(container.querySelectorAll("[data-row-height]").length, container.innerHTML).toBe(3);
  expect(measured.toSorted((a, b) => a.index - b.index)).toEqual(
    heights.map((size, index) => ({ index, size })),
  );
});
