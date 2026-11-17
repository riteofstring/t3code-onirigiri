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

type RightPanelStore = ReturnType<typeof useRightPanelStore.getState>;
type RightPanelAction = Exclude<keyof SurfaceNavigation, "hasSurface">;

// Reads the store on every call, so an action replaced with setState is the one that runs.
const storeAction = <Key extends RightPanelAction>(key: Key): RightPanelStore[Key] =>
  ((...args: never[]) =>
    (useRightPanelStore.getState()[key] as (...args: never[]) => unknown)(
      ...args,
    )) as RightPanelStore[Key];

const nativeNavigation: SurfaceNavigation = {
  open: storeAction("open"),
  openBrowser: storeAction("openBrowser"),
  openFile: storeAction("openFile"),
  openAttachment: storeAction("openAttachment"),
  openPullRequest: storeAction("openPullRequest"),
  openTerminal: storeAction("openTerminal"),
  openDevice: storeAction("openDevice"),
  renameDevice: storeAction("renameDevice"),
  closeSurface: storeAction("closeSurface"),
  close: storeAction("close"),
  openProactive: storeAction("openProactive"),
  getUserActionRevision: storeAction("getUserActionRevision"),
  splitTerminal: storeAction("splitTerminal"),
  activateTerminal: storeAction("activateTerminal"),
  closeTerminal: storeAction("closeTerminal"),
  reconcileBrowserSurfaces: storeAction("reconcileBrowserSurfaces"),
  hasSurface: (ref, id) =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces.some(
      (surface) => surface.id === id,
    ),
};

export function useSurfaceNavigation(): SurfaceNavigation {
  return useContext(SurfaceNavigationContext) ?? nativeNavigation;
}

export function useHasSurfaceNavigation(): boolean {
  return useContext(SurfaceNavigationContext) !== null;
}
