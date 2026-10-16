// @vitest-environment jsdom

import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { THREAD_JUMP_HINT_SHOW_DELAY_MS, useThreadJumpHintVisibility } from "./Sidebar.logic";
import { ThreadJumpHintTracker } from "./ThreadJumpHintTracker";

vi.mock("../env", () => ({ isElectron: false }));

const keybindings = compileResolvedKeybindingsConfig([
  { key: "mod+1", command: "thread.jump.1", when: "!terminalOpen && !modelPickerOpen" },
]);

describe("ThreadJumpHintTracker", () => {
  let root: Root;
  let container: HTMLDivElement;
  const renderSidebar = vi.fn();

  function Sidebar({
    terminalOpen = false,
    bindings = keybindings,
  }: {
    terminalOpen?: boolean;
    bindings?: typeof keybindings;
  }) {
    const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
    renderSidebar();
    return (
      <>
        <ThreadJumpHintTracker
          keybindings={bindings}
          terminalOpen={terminalOpen}
          onVisibilityChange={updateThreadJumpHintsVisibility}
        />
        <output>{showThreadJumpHints ? "Ctrl+1" : "hidden"}</output>
        <input aria-label="Composer" />
        <div data-terminal-owner="drawer">
          <input aria-label="Terminal" />
        </div>
      </>
    );
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Sidebar />));
    renderSidebar.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function key(type: "keydown" | "keyup", key: string, init: KeyboardEventInit = {}) {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent(type, { key, ...init }));
    });
  }

  async function waitForHints() {
    await act(async () => vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS));
  }

  function hint() {
    return container.querySelector("output")?.textContent;
  }

  it("shows hints for a custom unmodified binding when the sidebar mounts", async () => {
    const bindings = compileResolvedKeybindingsConfig([{ key: "1", command: "thread.jump.1" }]);
    await act(async () => root.render(<Sidebar key="unmodified" bindings={bindings} />));
    await waitForHints();
    expect(hint()).toBe("Ctrl+1");
  });

  it.each([
    ["isWeb", "Ctrl+1"],
    ["isDesktop", "hidden"],
  ])("respects a binding restricted to %s", async (when, expected) => {
    const bindings = compileResolvedKeybindingsConfig([
      { key: "mod+1", command: "thread.jump.1", when },
    ]);
    await act(async () => root.render(<Sidebar bindings={bindings} />));
    await key("keydown", "Control", { ctrlKey: true });
    await waitForHints();
    expect(hint()).toBe(expected);
  });

  it("keeps navigation modifier tracking out of the sidebar render path", async () => {
    for (const arrow of ["ArrowRight", "ArrowLeft"]) {
      await key("keydown", "Control", { ctrlKey: true });
      await key("keydown", "Alt", { ctrlKey: true, altKey: true });
      await key("keydown", arrow, { ctrlKey: true, altKey: true });
      await key("keyup", arrow, { ctrlKey: true, altKey: true });
      await key("keyup", "Alt", { ctrlKey: true });
      await key("keyup", "Control");
    }
    await waitForHints();
    expect(hint()).toBe("hidden");
    expect(renderSidebar).not.toHaveBeenCalled();

    await key("keydown", "Control", { ctrlKey: true });
    await act(async () => vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS - 1));
    expect(hint()).toBe("hidden");
    await act(async () => vi.advanceTimersByTime(1));
    expect(hint()).toBe("Ctrl+1");
    await key("keydown", "Alt", { ctrlKey: true, altKey: true });
    expect(hint()).toBe("hidden");
  });

  it.each(["paste", "blur"])(
    "clears hints on %s without trusting stale modifier flags",
    async (type) => {
      await key("keydown", "Control", { ctrlKey: true });
      await waitForHints();
      expect(hint()).toBe("Ctrl+1");
      await act(async () => window.dispatchEvent(new Event(type)));
      expect(hint()).toBe("hidden");
      await key("keydown", "Enter", { ctrlKey: true });
      await waitForHints();
      expect(hint()).toBe("hidden");
    },
  );

  it("updates held-key hints when terminal focus or route context changes", async () => {
    await key("keydown", "Control", { ctrlKey: true });
    await waitForHints();
    expect(hint()).toBe("Ctrl+1");
    await act(async () =>
      container.querySelector<HTMLInputElement>('[aria-label="Terminal"]')?.focus(),
    );
    expect(hint()).toBe("hidden");
    await act(async () =>
      container.querySelector<HTMLInputElement>('[aria-label="Composer"]')?.focus(),
    );
    await waitForHints();
    expect(hint()).toBe("Ctrl+1");
    await act(async () => root.render(<Sidebar terminalOpen />));
    expect(hint()).toBe("hidden");
    await act(async () => root.render(<Sidebar />));
    await waitForHints();
    expect(hint()).toBe("Ctrl+1");
  });
});
