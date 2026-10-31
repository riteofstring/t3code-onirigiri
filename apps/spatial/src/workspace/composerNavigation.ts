export const COMPOSER_NAVIGATION = "onirigiri-composer-navigation";

const directions = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
} as const;

type Direction = (typeof directions)[keyof typeof directions];

function hasContent(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent?.length ?? 0) > 0;
  return (
    node instanceof Element &&
    !node.matches("br.ProseMirror-trailingBreak, img.ProseMirror-separator")
  );
}

function atBoundary(editor: HTMLElement, range: Range, start: boolean): boolean {
  let node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    if (start ? offset !== 0 : offset !== node.textContent?.length) return false;
  } else {
    const remaining = [...node.childNodes].slice(start ? 0 : offset, start ? offset : undefined);
    if (remaining.some(hasContent)) return false;
  }
  while (node !== editor) {
    let sibling = start ? node.previousSibling : node.nextSibling;
    while (sibling) {
      if (hasContent(sibling)) return false;
      sibling = start ? sibling.previousSibling : sibling.nextSibling;
    }
    if (!node.parentNode) return false;
    node = node.parentNode;
  }
  return true;
}

function emptyEditorCaret(editor: HTMLElement): Range | null {
  const range = editor.ownerDocument.createRange();
  const paragraph = editor.firstChild;
  if (
    paragraph !== null &&
    (editor.childNodes.length !== 1 ||
      !(paragraph instanceof HTMLElement) ||
      paragraph.tagName !== "P" ||
      paragraph.getAttribute("contenteditable") === "false" ||
      paragraph.hasAttribute("data-node-view-wrapper"))
  )
    return null;
  range.setStart(paragraph ?? editor, 0);
  return atBoundary(editor, range, false) ? range : null;
}

export function installComposerNavigation({
  enabled,
  navigate,
}: {
  enabled: (editor: HTMLElement) => boolean;
  navigate: (direction: Direction) => void;
}) {
  const composing = new WeakSet<EventTarget>();
  const start = (event: CompositionEvent) => {
    if (event.target) composing.add(event.target);
  };
  const end = (event: CompositionEvent) => {
    if (event.target) composing.delete(event.target);
  };
  const key = (event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !(event.key in directions)) return;
    const editor =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            '[data-testid="composer-editor"][contenteditable="true"]',
          )
        : null;
    if (!editor || !enabled(editor) || event.defaultPrevented) return;
    const selection = editor.ownerDocument.getSelection();
    const selected = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const range =
      selected && editor.contains(selected.startContainer) ? selected : emptyEditorCaret(editor);
    const native =
      event.isComposing ||
      event.keyCode === 229 ||
      event.getModifierState("AltGraph") ||
      composing.has(editor) ||
      (selection !== null && !selection.isCollapsed) ||
      (selection?.rangeCount ?? 0) > 1 ||
      !range ||
      !range.collapsed;
    if (native) return;
    const direction = directions[event.key as keyof typeof directions];
    if (!event.shiftKey && !atBoundary(editor, range, direction === "left" || direction === "up"))
      return;
    event.stopPropagation();
    event.preventDefault();
    window.dispatchEvent(new Event(COMPOSER_NAVIGATION));
    navigate(direction);
  };
  window.addEventListener("compositionstart", start, true);
  window.addEventListener("compositionend", end, true);
  window.addEventListener("keydown", key, true);
  return () => {
    window.removeEventListener("compositionstart", start, true);
    window.removeEventListener("compositionend", end, true);
    window.removeEventListener("keydown", key, true);
  };
}
