import { LegendList } from "@legendapp/list/react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

it.each([0.68, 1, 1.5])("measures rows in layout pixels at camera scale %s", async (zoom) => {
  const heights = [140, 220, 100];
  const measured = new Map<number, number>();
  const container = document.createElement("div");
  container.style.cssText = `width: 420px; height: 600px; transform: scale(${zoom}); transform-origin: 0 0;`;
  // A bare list probe; nothing here navigates.
  await using _screen = await render(
    <div style={{ width: 420, height: 600, display: "flex", flexDirection: "column" }}>
      <LegendList
        data={heights}
        estimatedItemSize={90}
        recycleItems={false}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item }) => <div style={{ height: item }}>Conversation row</div>}
        onItemSizeChanged={({ index, size }) => measured.set(index, size)}
        style={{ flex: 1 }}
      />
    </div>,
    { container, router: false },
  );
  await vi.waitFor(() => expect(measured.size).toBe(heights.length));
  expect([...measured].toSorted(([a], [b]) => a - b).map(([, size]) => size)).toEqual(heights);
});
