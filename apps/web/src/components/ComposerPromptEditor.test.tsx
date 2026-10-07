import { createRef, useImperativeHandle } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { type ChatViewActivity, ChatViewActivityContext } from "./chatViewActivity";
import { ComposerPromptEditor } from "./ComposerPromptEditor";
import type {
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";

const focusCalls: string[] = [];

vi.mock("./ComposerPromptEditorTiptap", () => ({
  ComposerPromptEditorTiptap: ({ editorRef }: ComposerPromptEditorProps) => {
    useImperativeHandle(editorRef, () => ({
      focus: () => focusCalls.push("focus"),
      focusAt: (cursor: number) => focusCalls.push(`focusAt:${cursor}`),
      focusAtEnd: () => focusCalls.push("focusAtEnd"),
      readSelectionRange: () => ({ start: 0, end: 0 }),
      requestCitationComment: () => {},
      readSnapshot: () => ({ value: "live", cursor: 4, expandedCursor: 4, contextIds: [] }),
      isCaretOnVisualEdge: () => false,
    }));
    return <div data-editor="tiptap" />;
  },
}));

function activitySource(initial: boolean) {
  let active = initial;
  const listeners = new Set<() => void>();
  const activity: ChatViewActivity = {
    isActive: () => active,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const setActive = (next: boolean) => {
    active = next;
    for (const listener of listeners) listener();
  };
  return { activity, setActive };
}

function props(
  editorRef: React.RefObject<ComposerPromptEditorHandle | null>,
  value = "",
): ComposerPromptEditorProps {
  return {
    value,
    cursor: 0,
    contextRecords: new Map(),
    skills: [],
    disabled: false,
    placeholder: "Ask anything",
    onChange: () => {},
    onPaste: () => {},
    editorRef,
  };
}

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  focusCalls.length = 0;
  vi.unstubAllGlobals();
});

const usesTiptap = () => renderer.root.findAll((node) => node.props["data-editor"]).length > 0;

it("shows a static empty editor while passive and keeps the real one once active", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { activity, setActive } = activitySource(false);
  const editorRef = createRef<ComposerPromptEditorHandle>();
  await act(() => {
    renderer = create(
      <ChatViewActivityContext value={activity}>
        <ComposerPromptEditor {...props(editorRef)} />
      </ChatViewActivityContext>,
    );
  });
  expect(usesTiptap()).toBe(false);
  expect(renderer.root.findByProps({ "data-testid": "composer-editor" }).props.role).toBe(
    "textbox",
  );
  expect(editorRef.current?.readSnapshot().value).toBe("");

  await act(() => setActive(true));
  expect(usesTiptap()).toBe(true);
  await act(() => setActive(false));
  expect(usesTiptap()).toBe(true);
});

it("applies a focus request made before the real editor mounted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { activity } = activitySource(false);
  const editorRef = createRef<ComposerPromptEditorHandle>();
  await act(() => {
    renderer = create(
      <ChatViewActivityContext value={activity}>
        <ComposerPromptEditor {...props(editorRef)} />
      </ChatViewActivityContext>,
    );
  });
  await act(() => editorRef.current?.focusAt(3));
  expect(usesTiptap()).toBe(true);
  expect(focusCalls).toEqual(["focusAt:3"]);
  expect(editorRef.current?.readSnapshot().value).toBe("live");
});

it("uses the real editor for a passive view with a prompt", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { activity } = activitySource(false);
  await act(() => {
    renderer = create(
      <ChatViewActivityContext value={activity}>
        <ComposerPromptEditor {...props(createRef(), "draft")} />
      </ChatViewActivityContext>,
    );
  });
  expect(usesTiptap()).toBe(true);
});
