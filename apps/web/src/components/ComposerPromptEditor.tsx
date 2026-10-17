/**
 * The composer editor. Tiptap in both modes: the `richTextEnabled` setting
 * toggles Markdown styling, never the engine. Plain mode keeps Markdown
 * markers literal; `literalText` also preserves context-token sources as text.
 */
export { ComposerPromptEditorTiptap as ComposerPromptEditor } from "./ComposerPromptEditorTiptap";

export type {
  ComposerCitationCommentRequest,
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";
