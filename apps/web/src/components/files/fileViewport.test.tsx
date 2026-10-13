// @vitest-environment jsdom
import { getSharedHighlighter, type File as FileInstance } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/editor";
import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";

import { useFileViewport } from "./useFileViewport";

const observers = new Set<RecordedIntersectionObserver>();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let root: Root;
let host: HTMLDivElement;
let editor: Editor<undefined>;
let instance: FileInstance<unknown>;
let container: HTMLElement;

class RecordedIntersectionObserver {
  readonly targets = new Set<Element>();

  constructor(readonly callback: IntersectionObserverCallback) {
    observers.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
}

async function drain() {
  await act(async () => {
    for (let turn = 0; turn < 20; turn += 1) {
      await Promise.resolve();
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(turn * 16);
    }
  });
  expect(frames.size).toBe(0);
}

async function intersect(visible: boolean) {
  await act(() => {
    for (const observer of observers) {
      if (!observer.targets.has(container)) continue;
      observer.callback(
        [
          {
            target: container,
            isIntersecting: visible,
            intersectionRatio: visible ? 1 : 0,
            boundingClientRect: container.getBoundingClientRect(),
            intersectionRect: container.getBoundingClientRect(),
            rootBounds: null,
            time: 0,
          },
        ],
        observer as unknown as IntersectionObserver,
      );
    }
  });
  await drain();
}

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ["pierre-dark"],
    langs: ["text"],
    preferredHighlighter: "shiki-wasm",
  });
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", RecordedIntersectionObserver);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  Object.defineProperty(CSSStyleSheet.prototype, "replaceSync", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 300),
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(300);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  editor = new Editor();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  editor.cleanUp();
  frames.clear();
  observers.clear();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(CSSStyleSheet.prototype, "replaceSync");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function FileView({ editable = true }: { editable?: boolean }) {
  const onPostRender = useFileViewport((element, file) => {
    container = element;
    instance = file;
  });
  return (
    <EditProvider editor={editor}>
      <Virtualizer>
        <File
          file={{ name: "notes.txt", contents: "Keep this editable.\n", cacheKey: "notes" }}
          options={{
            theme: "pierre-dark",
            themeType: "dark",
            preferredHighlighter: "shiki-wasm",
            disableFileHeader: true,
            onPostRender,
          }}
          contentEditable={editable}
        />
      </Virtualizer>
    </EditProvider>
  );
}

it("restores a virtualized file at the same viewport without replacing its editor or undo history", async () => {
  await act(() => root.render(<FileView />));
  await drain();
  await intersect(true);
  const retainedInstance = instance;
  expect(container.shadowRoot?.querySelector("[data-line]")?.textContent).toBe(
    "Keep this editable.",
  );
  await act(() =>
    editor.applyEdits([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: "Edited: ",
      },
    ]),
  );
  await drain();
  await intersect(false);
  expect(container.shadowRoot?.querySelector("[data-placeholder]")).not.toBeNull();
  await intersect(true);
  expect(instance).toBe(retainedInstance);
  expect(container.shadowRoot?.querySelector("[data-line]")?.textContent).toBe(
    "Edited: Keep this editable.",
  );
  expect(editor.canUndo).toBe(true);
  await act(() => editor.undo());
  await drain();
  expect(container.shadowRoot?.querySelector("[data-line]")?.textContent).toBe(
    "Keep this editable.",
  );
});

it("restores read-only source when it becomes visible without focusing it", async () => {
  await act(() => root.render(<FileView editable={false} />));
  await drain();
  await intersect(true);
  expect(container.shadowRoot?.querySelector("[data-line]")?.textContent).toBe(
    "Keep this editable.",
  );
  await intersect(false);
  expect(container.shadowRoot?.querySelector("[data-line]")).toBeNull();
  await intersect(true);
  expect(container.shadowRoot?.querySelector("[data-line]")?.textContent).toBe(
    "Keep this editable.",
  );
  expect(document.activeElement).toBe(document.body);
});
