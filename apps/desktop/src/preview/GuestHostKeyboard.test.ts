// @vitest-environment jsdom
import type { DesktopPreviewHostShortcut } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createGuestHostKeyboard } from "./GuestHostKeyboard.ts";

const navigation: DesktopPreviewHostShortcut = {
  key: "ArrowRight",
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};
const rearrangement = { ...navigation, ctrlKey: true, whileEditing: true };

function key(overrides: Partial<KeyboardEvent> = {}) {
  return {
    ...navigation,
    code: "ArrowRight",
    keyCode: 39,
    repeat: false,
    isComposing: false,
    isTrusted: true,
    defaultPrevented: false,
    target: document.body,
    composedPath: () => [],
    getModifierState: () => false,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("leaves native Browser input alone until the host opts in, and releases it on opt-out", () => {
  const send = vi.fn();
  const keyboard = createGuestHostKeyboard(document, send);
  for (const configuration of [undefined, [], null, [{ ...navigation, altKey: "true" }]]) {
    if (configuration !== undefined) keyboard.configure(configuration);
    const event = key();
    keyboard.keyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
  keyboard.configure([navigation]);
  const event = key({ repeat: true });
  keyboard.keyDown(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      key: "ArrowRight",
      repeat: true,
      editing: false,
    }),
  );
  keyboard.configure([]);
  keyboard.keyDown(key());
  expect(send).toHaveBeenCalledTimes(1);
});

it("preserves text movement but forwards configured editing chords from guest inputs", () => {
  const send = vi.fn();
  const keyboard = createGuestHostKeyboard(document, send);
  keyboard.configure([navigation, rearrangement]);
  const input = document.createElement("textarea");
  document.body.append(input);
  const movement = key({ target: input });
  keyboard.keyDown(movement);
  expect(movement.preventDefault).not.toHaveBeenCalled();
  const configured = key({ ctrlKey: true, target: input });
  keyboard.keyDown(configured);
  expect(configured.preventDefault).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      ctrlKey: true,
      editing: true,
    }),
  );
});

it("does not forward composition, AltGraph, page-generated input, extra modifiers or unfocused guests", () => {
  const send = vi.fn();
  const keyboard = createGuestHostKeyboard(document, send);
  keyboard.configure([navigation, rearrangement]);
  for (const overrides of [
    { isComposing: true },
    { keyCode: 229 },
    { key: "Process" },
    { getModifierState: () => true },
    { isTrusted: false },
    { defaultPrevented: true },
    { shiftKey: true },
    { metaKey: true },
  ]) {
    const event = key(overrides);
    keyboard.keyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
  vi.mocked(document.hasFocus).mockReturnValue(false);
  keyboard.keyDown(key());
  expect(send).not.toHaveBeenCalled();
});

it("keeps guest dialogs in control and recognizes macOS Option character chords", () => {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
  const send = vi.fn();
  const keyboard = createGuestHostKeyboard(document, send);
  keyboard.configure([navigation, { ...navigation, key: "o" }]);
  const dialog = document.createElement("dialog");
  dialog.open = true;
  document.body.append(dialog);
  keyboard.keyDown(key({ target: dialog }));
  expect(send).not.toHaveBeenCalled();
  keyboard.keyDown(key({ key: "ø", code: "KeyO" }));
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: "ø", code: "KeyO" }));
});
