import type { DesktopPreviewHostKey, DesktopPreviewHostShortcut } from "@t3tools/contracts";

export const DESKTOP_PREVIEW_HOST_SHORTCUTS_CHANNEL = "preview:host-shortcuts";
export const DESKTOP_PREVIEW_HOST_KEY_CHANNEL = "preview:host-key";

function isShortcut(value: unknown): value is DesktopPreviewHostShortcut {
  return (
    typeof value === "object" &&
    value !== null &&
    "key" in value &&
    typeof value.key === "string" &&
    value.key.length > 0 &&
    value.key.length <= 32 &&
    "altKey" in value &&
    typeof value.altKey === "boolean" &&
    "ctrlKey" in value &&
    typeof value.ctrlKey === "boolean" &&
    "metaKey" in value &&
    typeof value.metaKey === "boolean" &&
    "shiftKey" in value &&
    typeof value.shiftKey === "boolean" &&
    (!("whileEditing" in value) || typeof value.whileEditing === "boolean")
  );
}

export function isPreviewHostShortcuts(
  value: unknown,
): value is readonly DesktopPreviewHostShortcut[] {
  return Array.isArray(value) && value.length <= 128 && value.every(isShortcut);
}

export function isPreviewHostKey(value: unknown): value is DesktopPreviewHostKey {
  return (
    isShortcut(value) &&
    "code" in value &&
    typeof value.code === "string" &&
    value.code.length <= 32 &&
    "repeat" in value &&
    typeof value.repeat === "boolean" &&
    "isComposing" in value &&
    typeof value.isComposing === "boolean" &&
    "keyCode" in value &&
    typeof value.keyCode === "number" &&
    Number.isInteger(value.keyCode) &&
    value.keyCode >= 0 &&
    value.keyCode <= 65535 &&
    "altGraph" in value &&
    typeof value.altGraph === "boolean" &&
    "editing" in value &&
    typeof value.editing === "boolean"
  );
}

export function matchesPreviewHostShortcut(
  input: DesktopPreviewHostKey,
  shortcuts: readonly DesktopPreviewHostShortcut[],
  platform: string,
): boolean {
  if (input.isComposing || input.keyCode === 229 || input.key === "Process" || input.altGraph) {
    return false;
  }
  const keys = [input.key];
  if (input.altKey && /Mac|iPhone|iPad|iPod/.test(platform) && /^Key[A-Z]$/.test(input.code)) {
    keys.push(input.code.slice(3));
  }
  return shortcuts.some(
    (shortcut) =>
      (!input.editing || shortcut.whileEditing === true) &&
      shortcut.altKey === input.altKey &&
      shortcut.ctrlKey === input.ctrlKey &&
      shortcut.metaKey === input.metaKey &&
      shortcut.shiftKey === input.shiftKey &&
      keys.some((key) =>
        Array.from(shortcut.key).length === 1 && Array.from(key).length === 1
          ? shortcut.key.toLowerCase() === key.toLowerCase()
          : shortcut.key === key,
      ),
  );
}
