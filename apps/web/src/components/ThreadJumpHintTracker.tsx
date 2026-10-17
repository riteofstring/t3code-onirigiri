import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect } from "react";

import { isElectron } from "../env";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { shouldShowThreadJumpHintsForModifiers } from "../keybindings";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { useShortcutModifierState } from "../shortcutModifierState";

export function ThreadJumpHintTracker({
  keybindings,
  terminalOpen,
  onVisibilityChange,
}: {
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  onVisibilityChange: (visible: boolean) => void;
}) {
  // Same predicate as v1: hints show only while the held modifiers exactly
  // match a thread-jump binding. Adding Shift (screenshots) or Alt no
  // longer matches ⌘1..9, so the overlay hides for chords like ⌘⇧4.
  const modifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const shouldShow = shouldShowThreadJumpHintsForModifiers(modifiers, keybindings, {
    platform: navigator.platform,
    context: {
      terminalFocus: terminalFocused,
      terminalOpen,
      modelPickerOpen: isModelPickerOpen(),
      isWeb: !isElectron,
      isDesktop: isElectron,
    },
  });

  useEffect(() => {
    onVisibilityChange(shouldShow);
  }, [onVisibilityChange, shouldShow]);

  return null;
}
