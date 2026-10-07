import { useEffect, useImperativeHandle, useState, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";

import { useChatViewActivity } from "./chatViewActivity";
import { ComposerPromptEditorTiptap } from "./ComposerPromptEditorTiptap";
import type {
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";

export type {
  ComposerCitationCommentRequest,
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";

/**
 * The composer editor. Tiptap in both modes: the `richTextEnabled` setting
 * toggles Markdown styling, never the engine. Plain mode renders every
 * marker as a literal character and serializes byte-identically.
 *
 * A passive ChatView with an empty prompt shows a static copy of the empty
 * editor instead, so a host showing many threads does not build an editor for
 * each. The real editor replaces it for good once the view becomes active or
 * the user points at it, and receives any focus requested in between.
 */
export function ComposerPromptEditor(props: ComposerPromptEditorProps) {
  const activity = useChatViewActivity();
  const active = useSyncExternalStore(activity.subscribe, activity.isActive);
  const empty = props.value === "" && props.contextRecords.size === 0;
  const [warm, setWarm] = useState(() => active || !empty);
  const [pendingFocus, setPendingFocus] = useState<
    ((editor: ComposerPromptEditorHandle) => void) | null
  >(null);
  if (!warm && (active || !empty)) setWarm(true);

  const { editorRef } = props;
  useEffect(() => {
    if (!warm || !pendingFocus || !editorRef.current) return;
    pendingFocus(editorRef.current);
    setPendingFocus(null);
  }, [editorRef, pendingFocus, warm]);

  if (warm) return <ComposerPromptEditorTiptap {...props} />;
  return (
    <StaticEmptyComposerEditor
      {...props}
      onWarm={(focus) => {
        setPendingFocus(() => focus);
        setWarm(true);
      }}
    />
  );
}

function StaticEmptyComposerEditor({
  ariaLabel,
  className,
  containerClassName,
  disabled,
  editorRef,
  onWarm,
  placeholder,
  placeholderClassName,
  richTextEnabled,
}: ComposerPromptEditorProps & {
  onWarm: (focus: (editor: ComposerPromptEditorHandle) => void) => void;
}) {
  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => onWarm((editor) => editor.focus()),
      focusAt: (cursor) => onWarm((editor) => editor.focusAt(cursor)),
      focusAtEnd: () => onWarm((editor) => editor.focusAtEnd()),
      readSelectionRange: () => ({ start: 0, end: 0 }),
      requestCitationComment: (request) =>
        onWarm((editor) => editor.requestCitationComment(request)),
      readSnapshot: () => ({ value: "", cursor: 0, expandedCursor: 0, contextIds: [] }),
      isCaretOnVisualEdge: () => true,
    }),
    [onWarm],
  );

  return (
    <div
      className={cn(
        "relative flow-root font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) max-sm:pointer-coarse:text-(length:--font-size-prompt-touch)",
        containerClassName,
      )}
      onPointerDown={() => onWarm((editor) => editor.focus())}
    >
      <div>
        <div
          role="textbox"
          data-testid="composer-editor"
          data-composer-rich-text={richTextEnabled ? "true" : "false"}
          aria-multiline="true"
          aria-label={ariaLabel}
          aria-readonly={disabled ? "true" : undefined}
          aria-placeholder={placeholder}
          translate="no"
          tabIndex={0}
          onFocus={() => onWarm((editor) => editor.focus())}
          className={cn(
            "ProseMirror composer-tiptap -m-1 block max-h-52 min-h-19.5 overflow-y-auto p-1 whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none",
            className,
          )}
        >
          <p>
            <br />
          </p>
        </div>
      </div>
      {placeholder ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 leading-relaxed text-placeholder/75",
            placeholderClassName,
          )}
        >
          {placeholder}
        </div>
      ) : null}
    </div>
  );
}
