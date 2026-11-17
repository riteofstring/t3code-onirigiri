import { useEffect, useRef, useState } from "react";
import { isEditableFocused } from "./lib/editableFocus";

export interface ShortcutModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const EMPTY_SHORTCUT_MODIFIER_STATE: ShortcutModifierState = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

function areShortcutModifierStatesEqual(
  left: ShortcutModifierState,
  right: ShortcutModifierState,
): boolean {
  return (
    left.metaKey === right.metaKey &&
    left.ctrlKey === right.ctrlKey &&
    left.altKey === right.altKey &&
    left.shiftKey === right.shiftKey
  );
}

// One listener set keeps the held modifiers for every user of the hook, so a view enabled while a
// modifier is already down starts from it without having rendered on each key press before.
let heldModifiers = EMPTY_SHORTCUT_MODIFIER_STATE;
let heldModifierUsers = 0;
const trackHeldModifiers = (event: KeyboardEvent) => {
  heldModifiers = shortcutModifierStateAfterKeyboardEvent(heldModifiers, event);
};
const forgetHeldModifiers = () => {
  heldModifiers = EMPTY_SHORTCUT_MODIFIER_STATE;
};
function watchHeldModifiers() {
  if (heldModifierUsers++ === 0) {
    window.addEventListener("keydown", trackHeldModifiers, true);
    window.addEventListener("keyup", trackHeldModifiers, true);
    window.addEventListener("paste", forgetHeldModifiers, true);
    window.addEventListener("blur", forgetHeldModifiers);
  }
  return () => {
    if (--heldModifierUsers > 0) return;
    window.removeEventListener("keydown", trackHeldModifiers, true);
    window.removeEventListener("keyup", trackHeldModifiers, true);
    window.removeEventListener("paste", forgetHeldModifiers, true);
    window.removeEventListener("blur", forgetHeldModifiers);
    forgetHeldModifiers();
  };
}

/** `enabled` false stops tracking, so a view that is not the active one skips every key press. */
export function useShortcutModifierState(
  ignoreEditable = false,
  enabled = true,
): ShortcutModifierState {
  const [state, setState] = useState(EMPTY_SHORTCUT_MODIFIER_STATE);
  const stateRef = useRef(EMPTY_SHORTCUT_MODIFIER_STATE);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the shared window listeners that record held modifiers while any user of this hook is mounted
  useEffect(watchHeldModifiers, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window key, focus, paste and blur listeners that track held shortcut modifiers
  useEffect(() => {
    const updateState = (next: ShortcutModifierState) => {
      if (areShortcutModifierStatesEqual(stateRef.current, next)) return;
      stateRef.current = next;
      setState(next);
    };
    const onKeyboardEvent = (event: KeyboardEvent) => {
      updateState(
        ignoreEditable && isEditableFocused(event.target)
          ? EMPTY_SHORTCUT_MODIFIER_STATE
          : shortcutModifierStateAfterKeyboardEvent(stateRef.current, event),
      );
    };
    // Dictation tools can omit Meta keyup after synthetic paste, leaving jump hints stuck.
    const onResetEvent = () => {
      updateState(EMPTY_SHORTCUT_MODIFIER_STATE);
    };

    if (!enabled) {
      onResetEvent();
      return;
    }
    const onFocus = (event: FocusEvent) => {
      if (ignoreEditable && isEditableFocused(event.target)) onResetEvent();
    };
    if (!(ignoreEditable && isEditableFocused(document.activeElement))) updateState(heldModifiers);
    window.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKeyboardEvent, true);
    window.addEventListener("keyup", onKeyboardEvent, true);
    window.addEventListener("paste", onResetEvent, true);
    window.addEventListener("blur", onResetEvent);
    return () => {
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKeyboardEvent, true);
      window.removeEventListener("keyup", onKeyboardEvent, true);
      window.removeEventListener("paste", onResetEvent, true);
      window.removeEventListener("blur", onResetEvent);
    };
  }, [enabled, ignoreEditable]);

  return state;
}

function normalizeModifierKey(key: string): keyof ShortcutModifierState | null {
  switch (key) {
    case "Meta":
    case "OS":
    case "Command":
      return "metaKey";
    case "Control":
      return "ctrlKey";
    case "Alt":
    case "Option":
      return "altKey";
    case "Shift":
      return "shiftKey";
    default:
      return null;
  }
}

export function shortcutModifierStateAfterKeyboardEvent(
  currentState: ShortcutModifierState,
  event: KeyboardEvent,
): ShortcutModifierState {
  const normalizedModifierKey = normalizeModifierKey(event.key);
  let nextState: ShortcutModifierState;
  if (normalizedModifierKey) {
    nextState = {
      ...currentState,
      [normalizedModifierKey]: event.type === "keydown",
    };
  } else {
    // Dictation paste can poison real events with metaKey=true until a physical Meta press.
    nextState = {
      metaKey: currentState.metaKey && event.metaKey,
      ctrlKey: currentState.ctrlKey && event.ctrlKey,
      altKey: currentState.altKey && event.altKey,
      shiftKey: currentState.shiftKey && event.shiftKey,
    };
  }

  return areShortcutModifierStatesEqual(currentState, nextState) ? currentState : nextState;
}
