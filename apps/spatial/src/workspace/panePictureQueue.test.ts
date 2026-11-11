// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";

import { onScreen } from "./panePictureQueue";

afterEach(() => document.body.replaceChildren());

it.each([
  [100, true],
  [5000, false],
])("places a chat by its pane's box at %s without measuring inside the pane", (left, expected) => {
  const pane = document.createElement("section");
  pane.dataset.onirigiriSlot = "pane";
  pane.getBoundingClientRect = () => new DOMRect(left, 0, 400, 580);
  const content = document.createElement("div");
  const measured = vi.fn(() => new DOMRect(0, 0, 400, 580));
  content.getBoundingClientRect = measured;
  pane.append(content);
  document.body.append(pane);
  expect(onScreen(content)).toBe(expected);
  expect(measured).not.toHaveBeenCalled();
});
