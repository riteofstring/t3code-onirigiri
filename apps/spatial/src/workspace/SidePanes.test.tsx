// @vitest-environment jsdom
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { TerminalPane } from "./SidePanes";

const state = vi.hoisted(() => ({ terminalKeys: [] as string[], preventedKeys: [] as string[] }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("@t3tools/web/src/components/DiffPanel", () => ({ default: () => null }));
vi.mock("@t3tools/web/src/components/ui/button", () => ({ Button: () => null }));
vi.mock("@t3tools/web/src/hooks/useWorkspaceMutationRefresh", () => ({
  latestWorkspaceMutationId: () => null,
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThread: () => ({ projectId: "project-one", worktreePath: "/workspace" }),
  useProject: () => null,
}));
vi.mock("@t3tools/web/src/state/server", () => ({ primaryServerKeybindingsAtom: {} }));
vi.mock("@t3tools/web/src/state/terminal", () => ({ terminalEnvironment: { open: {} } }));
vi.mock("@t3tools/web/src/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("@t3tools/web/src/components/ThreadTerminalDrawer", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    TerminalViewport: ({ autoFocus }: { autoFocus: boolean }) => {
      const ref = useRef<HTMLTextAreaElement>(null);
      useEffect(() => {
        const input = ref.current!;
        const consume = (event: KeyboardEvent) => {
          if (event.defaultPrevented) {
            state.preventedKeys.push(event.key);
            return;
          }
          state.terminalKeys.push(event.key);
          event.preventDefault();
          event.stopPropagation();
        };
        input.addEventListener("keydown", consume);
        return () => input.removeEventListener("keydown", consume);
      }, []);
      useEffect(() => {
        if (autoFocus) ref.current?.focus();
      }, [autoFocus]);
      return <textarea ref={ref} aria-label="Terminal input" />;
    },
  };
});

let host: HTMLDivElement;
let root: Root;
let navigate: ReturnType<typeof vi.fn<(direction: string) => boolean>>;

async function render(focused = true) {
  await act(async () => {
    root.render(
      <>
        <TerminalPane
          thread={{
            environmentId: "environment-one" as EnvironmentId,
            threadId: "thread-one" as ThreadId,
          }}
          terminalId="terminal-one"
          focused={focused}
          live
          onNavigate={navigate}
        />
        <textarea aria-label="Chat composer" />
      </>,
    );
  });
}

function terminal() {
  return host.querySelector<HTMLTextAreaElement>('[aria-label="Terminal input"]')!;
}

function key(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.terminalKeys = [];
  state.preventedKeys = [];
  navigate = vi.fn(() => true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("reserves Option arrows before an autofocused terminal consumes them, including repeats and edges", async () => {
  await render();
  expect(document.activeElement).toBe(terminal());
  for (const keyName of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    expect(key(terminal(), keyName, { altKey: true }).defaultPrevented).toBe(true);
  }
  navigate.mockReturnValue(false);
  key(terminal(), "ArrowRight", { altKey: true, repeat: true });
  expect(navigate.mock.calls.map(([direction]) => direction)).toEqual([
    "left",
    "right",
    "up",
    "down",
    "right",
  ]);
  expect(state.terminalKeys).toEqual([]);
  expect(state.preventedKeys).toEqual([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "ArrowRight",
  ]);
});

it("leaves ordinary shell keys, modified arrows, composition and previously handled input alone", async () => {
  await render();
  key(terminal(), "x");
  key(terminal(), "ArrowLeft");
  key(terminal(), "c", { ctrlKey: true });
  key(terminal(), "ArrowRight", { altKey: true, shiftKey: true });
  key(terminal(), "ArrowRight", { altKey: true, ctrlKey: true });
  key(terminal(), "ArrowRight", { altKey: true, metaKey: true });
  key(terminal(), "ArrowRight", { altKey: true, isComposing: true });
  key(terminal(), "ArrowRight", { altKey: true, keyCode: 229 });
  key(terminal(), "ArrowRight", { altKey: true, modifierAltGraph: true });
  const handled = new KeyboardEvent("keydown", {
    key: "ArrowLeft",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  handled.preventDefault();
  terminal().dispatchEvent(handled);
  expect(navigate).not.toHaveBeenCalled();
  expect(state.terminalKeys).toHaveLength(9);
  expect(state.preventedKeys).toEqual(["ArrowLeft"]);
});

it("preserves Option word movement in chat fields and releases only the inactive terminal's focus", async () => {
  await render();
  const input = terminal();
  await render(false);
  expect(document.activeElement).not.toBe(input);
  expect(terminal()).toBe(input);
  const chat = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
  chat.focus();
  expect(key(chat, "ArrowLeft", { altKey: true }).defaultPrevented).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  await render(true);
  chat.focus();
  await render(false);
  expect(document.activeElement).toBe(chat);
});

it("does not navigate the workspace from a modal terminal", async () => {
  await render();
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  key(terminal(), "ArrowLeft", { altKey: true });
  expect(navigate).not.toHaveBeenCalled();
  expect(state.terminalKeys).toEqual(["ArrowLeft"]);
});
