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

class FakeElement {
  isContentEditable = false;
  readonly matches: string;
  constructor(matches: string) {
    this.matches = matches;
  }
  closest(selector: string) {
    return selector.split(",").some((part) => part.trim() === this.matches) ? this : null;
  }
}

const body = new FakeElement("body");
const guest = {
  hasFocus: vi.fn(() => true),
  defaultView: { navigator: { platform: "Linux x86_64" } },
};
const document = guest as unknown as Document;

function key(overrides: Partial<Omit<KeyboardEvent, "target">> & { target?: FakeElement } = {}) {
  return {
    ...navigation,
    code: "ArrowRight",
    keyCode: 39,
    repeat: false,
    isComposing: false,
    isTrusted: true,
    defaultPrevented: false,
    target: body,
    composedPath: () => [],
    getModifierState: () => false,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

beforeEach(() => {
  vi.stubGlobal("HTMLElement", FakeElement);
  guest.hasFocus.mockReturnValue(true);
  guest.defaultView.navigator.platform = "Linux x86_64";
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  const input = new FakeElement("textarea");
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
  guest.hasFocus.mockReturnValue(false);
  keyboard.keyDown(key());
  expect(send).not.toHaveBeenCalled();
});

it("keeps guest dialogs in control and recognizes macOS Option character chords", () => {
  guest.defaultView.navigator.platform = "MacIntel";
  const send = vi.fn();
  const keyboard = createGuestHostKeyboard(document, send);
  keyboard.configure([navigation, { ...navigation, key: "o" }]);
  const dialog = new FakeElement("dialog[open]");
  keyboard.keyDown(key({ target: dialog }));
  expect(send).not.toHaveBeenCalled();
  keyboard.keyDown(key({ key: "ø", code: "KeyO" }));
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: "ø", code: "KeyO" }));
});
