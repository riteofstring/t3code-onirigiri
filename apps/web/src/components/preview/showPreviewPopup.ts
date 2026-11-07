import type { ScopedThreadRef } from "@t3tools/contracts";

import { browserMiniPlayerSource, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { whenPreviewTabKnown } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import type { SurfaceNavigation } from "~/surfaceNavigation";

export function showPreviewPopup(
  threadRef: ScopedThreadRef,
  popupTabId: string,
  from: "panel" | "floating",
  openBrowser: SurfaceNavigation["openBrowser"] = useRightPanelStore.getState().openBrowser,
): void {
  whenPreviewTabKnown(threadRef, popupTabId, () => {
    if (from === "floating") {
      usePreviewMiniPlayerStore.getState().open(threadRef, browserMiniPlayerSource(popupTabId));
    } else {
      openBrowser(threadRef, popupTabId);
    }
  });
}
