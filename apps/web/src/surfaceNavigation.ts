import { createContext, useContext } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

export type SurfaceNavigation = Pick<
  ReturnType<typeof useRightPanelStore.getState>,
  | "open"
  | "openBrowser"
  | "openFile"
  | "openAttachment"
  | "openPullRequest"
  | "openTerminal"
  | "openDevice"
  | "renameDevice"
  | "closeSurface"
  | "close"
  | "openProactive"
  | "getUserActionRevision"
  | "splitTerminal"
  | "activateTerminal"
  | "closeTerminal"
  | "reconcileBrowserSurfaces"
> & {
  hasSurface: (ref: ScopedThreadRef, surfaceId: string) => boolean;
};

export const SurfaceNavigationContext = createContext<SurfaceNavigation | null>(null);

const nativeNavigation: SurfaceNavigation = (() => {
  const state = useRightPanelStore.getState();
  return {
    open: state.open,
    openBrowser: state.openBrowser,
    openFile: state.openFile,
    openAttachment: state.openAttachment,
    openPullRequest: state.openPullRequest,
    openTerminal: state.openTerminal,
    openDevice: state.openDevice,
    renameDevice: state.renameDevice,
    closeSurface: state.closeSurface,
    close: state.close,
    openProactive: state.openProactive,
    getUserActionRevision: state.getUserActionRevision,
    splitTerminal: state.splitTerminal,
    activateTerminal: state.activateTerminal,
    closeTerminal: state.closeTerminal,
    reconcileBrowserSurfaces: state.reconcileBrowserSurfaces,
    hasSurface: (ref, id) =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces.some(
        (surface) => surface.id === id,
      ),
  };
})();

export function useSurfaceNavigation(): SurfaceNavigation {
  return useContext(SurfaceNavigationContext) ?? nativeNavigation;
}

export function useHasSurfaceNavigation(): boolean {
  return useContext(SurfaceNavigationContext) !== null;
}
