import { createContext, useContext } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

export type SurfaceNavigation = Pick<
  ReturnType<typeof useRightPanelStore.getState>,
  | "open"
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
  openBrowser: (ref: ScopedThreadRef, tabId: string | null, automatic?: boolean) => void;
  hasSurface: (ref: ScopedThreadRef, surfaceId: string) => boolean;
};

export const SurfaceNavigationContext = createContext<SurfaceNavigation | null>(null);

let pageNavigation: SurfaceNavigation | null = null;

/** Routes page-lifetime services, such as agent-opened previews, through a host's own surfaces. */
export function setPageSurfaceNavigation(navigation: SurfaceNavigation | null): void {
  pageNavigation = navigation;
}

export function readPageSurfaceNavigation(): SurfaceNavigation | null {
  return pageNavigation;
}

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
