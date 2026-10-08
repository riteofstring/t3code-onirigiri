import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect } from "react";

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
  const modifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const shouldShow = shouldShowThreadJumpHintsForModifiers(modifiers, keybindings, {
    platform: navigator.platform,
    context: {
      terminalFocus: terminalFocused,
      terminalOpen,
      modelPickerOpen: isModelPickerOpen(),
    },
  });

  useEffect(() => {
    onVisibilityChange(shouldShow);
  }, [onVisibilityChange, shouldShow]);

  return null;
}
