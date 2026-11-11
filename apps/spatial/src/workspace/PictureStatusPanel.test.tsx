// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { livePaneProducer } from "./panePictureSnapshot";
import { describeElement, pictureLog, PictureStatusPanel } from "./PictureStatusPanel";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  pictureLog.producers.clear();
  document.body.replaceChildren();
});

it("names the element that keeps a chat live, such as one an extension injected", () => {
  const chat = document.createElement("div");
  chat.innerHTML = '<p>text</p><form><writing-helper id="wh"></writing-helper></form>';
  expect(describeElement(livePaneProducer(chat)!)).toBe("writing-helper#wh");
  chat.querySelector("writing-helper")!.remove();
  expect(livePaneProducer(chat)).toBeNull();
});

it("reads out the browser's picture support, the workspace's counts and what keeps chats live", async () => {
  pictureLog.producers.set("pane", "writing-helper#wh");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<PictureStatusPanel read={() => ({ "chats loaded": 3 })} />));
  await act(async () => vi.advanceTimersByTime(1000));
  const text = host.textContent ?? "";
  expect(text).toContain("html-in-canvas: false");
  expect(text).toContain("webgpu: no WebGPU");
  expect(text).toContain("chats loaded: 3");
  expect(text).toContain("chats kept live by: writing-helper#wh");
  await act(async () => root.unmount());
});
