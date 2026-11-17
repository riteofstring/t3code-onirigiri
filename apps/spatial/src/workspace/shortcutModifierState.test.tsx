// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vite-plus/test";

import { useShortcutModifierState } from "./shortcutModifierState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("renders on held modifiers only while enabled, and starts from one already held when enabled", async () => {
  let renders = 0;
  let altKey = false;
  function Probe({ enabled }: { enabled: boolean }) {
    renders += 1;
    altKey = useShortcutModifierState(false, enabled).altKey;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const press = (type: "keydown" | "keyup") =>
    act(async () => void window.dispatchEvent(new KeyboardEvent(type, { key: "Alt" })));

  await act(async () => root.render(<Probe enabled={false} />));
  const idle = renders;
  await press("keydown");
  expect(altKey).toBe(false);
  expect(renders).toBe(idle);
  await press("keyup");

  await act(async () => root.render(<Probe enabled />));
  await press("keydown");
  expect(altKey).toBe(true);

  await act(async () => root.render(<Probe enabled={false} />));
  expect(altKey).toBe(false);

  await act(async () => root.render(<Probe enabled />));
  expect(altKey).toBe(true);
  await press("keyup");
  expect(altKey).toBe(false);
  await act(async () => root.unmount());
});
