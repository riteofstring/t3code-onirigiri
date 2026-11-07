import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect } from "react";

import { isElectron } from "../env";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { shouldShowThreadJumpHintsForModifiers } from "../keybindings";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { useShortcutModifierState } from "../shortcutModifierState";
import { useThreadJumpHintsVisible } from "./Sidebar.logic";

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
      isWeb: !isElectron,
      isDesktop: isElectron,
    },
  });
  const visible = useThreadJumpHintsVisible(shouldShow);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps modifier-key and hint-delay subscriptions out of the Sidebar render; only the settled visibility reaches the parent
  useEffect(() => {
    onVisibilityChange(visible);
  }, [onVisibilityChange, visible]);

  return null;
}
