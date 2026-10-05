const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");

let chatFocused = true;

/** Records whether the focused pane is the one showing ChatView. */
export function setChatFocused(focused: boolean) {
  chatFocused = focused;
}

function targetsEditable(event: Event) {
  return event
    .composedPath()
    .some((target) => target instanceof Element && target.closest(EDITABLE_SELECTOR));
}

/**
 * ChatView redirects plain typing and pastes that land outside an editable
 * element into its composer. In the workspace that input belongs to the
 * focused pane, so it is stopped before ChatView's window listeners while
 * another pane has focus. Must be installed before ChatView mounts.
 */
export function installChatInputGate(target: Window) {
  target.addEventListener(
    "keydown",
    (event) => {
      if (chatFocused || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1 || targetsEditable(event)) return;
      event.stopImmediatePropagation();
    },
    true,
  );
  target.addEventListener(
    "paste",
    (event) => {
      if (chatFocused || targetsEditable(event)) return;
      event.stopImmediatePropagation();
    },
    true,
  );
}
