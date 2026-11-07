import type { ScopedThreadRef } from "@t3tools/contracts";
import { type ReactNode, useMemo } from "react";
import {
  attachmentSurface,
  browserSurface,
  closeTerminalSurface,
  deviceSurface,
  openFileSurface,
  pullRequestSurface,
  renameDeviceSurface,
  singletonSurface,
  splitTerminalSurface,
  terminalSurface,
  type RightPanelSurface,
} from "@t3tools/web/src/rightPanelStore";
import {
  SurfaceNavigationContext,
  type SurfaceNavigation,
} from "@t3tools/web/src/surfaceNavigation";
import {
  previewMiniPlayerSourceKey,
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "@t3tools/web/src/previewMiniPlayerStore";
import { toolPaneSurface, type useToolPanes } from "./useToolPanes";

export type ToolPaneController = ReturnType<typeof useToolPanes>;
const isNeverClosing = () => false;

export function createSpatialSurfaceNavigation(
  controller: Pick<
    ToolPaneController,
    | "getPanes"
    | "openSurface"
    | "updateSurface"
    | "remove"
    | "getUserActionRevision"
    | "recordUserAction"
  >,
  sourcePaneId: string,
  focusPane: (paneId: string) => void,
  isPaneClosing: (paneId: string) => boolean = isNeverClosing,
): SurfaceNavigation {
  const belongs = (ref: ScopedThreadRef, pane: { environmentId: string; threadId: string }) =>
    pane.environmentId === ref.environmentId && pane.threadId === ref.threadId;
  const find = (ref: ScopedThreadRef, surfaceId: string) =>
    controller
      .getPanes()
      .find(
        (pane) =>
          belongs(ref, pane) &&
          !isPaneClosing(pane.paneId) &&
          toolPaneSurface(pane)?.id === surfaceId,
      );
  const proactiveDiffTurns = new Map<string, string>();
  const open = (ref: ScopedThreadRef, surface: RightPanelSurface, automatic = false) => {
    if (
      controller
        .getPanes()
        .some(
          (pane) =>
            belongs(ref, pane) &&
            toolPaneSurface(pane)?.id === surface.id &&
            isPaneClosing(pane.paneId),
        )
    )
      return;
    const players = usePreviewMiniPlayerStore.getState();
    const floating = selectThreadPreviewMiniPlayer(players.byThreadKey, ref);
    if (floating && previewMiniPlayerSourceKey(floating.source) === surface.id) players.close(ref);
    if (automatic && find(ref, surface.id)) return;
    if (!automatic) controller.recordUserAction(ref);
    const id = controller.openSurface(ref, surface, sourcePaneId);
    if (!automatic) focusPane(id);
  };
  const mutate = (
    ref: ScopedThreadRef,
    surfaceId: string,
    change: (surface: RightPanelSurface) => RightPanelSurface,
  ) => {
    const pane = find(ref, surfaceId);
    if (pane) {
      controller.recordUserAction(ref);
      controller.updateSurface(pane.paneId, change);
    }
  };
  const closeSurface = (ref: ScopedThreadRef, surfaceId: string) => {
    const pane = find(ref, surfaceId);
    if (pane) {
      controller.recordUserAction(ref);
      controller.remove(pane.paneId);
    }
  };
  return {
    hasSurface: (ref, id) => find(ref, id) !== undefined,
    reconcileBrowserSurfaces(ref, tabIds) {
      const present = new Set(tabIds);
      for (const pane of controller.getPanes()) {
        if (!belongs(ref, pane) || isPaneClosing(pane.paneId)) continue;
        const surface = toolPaneSurface(pane);
        if (
          surface?.kind === "preview" &&
          surface.resourceId !== null &&
          !present.has(surface.resourceId)
        ) {
          controller.updateSurface(pane.paneId, () => browserSurface(null));
        }
      }
    },
    getUserActionRevision: controller.getUserActionRevision,
    openProactive(ref, request, expectedRevision) {
      if (controller.getUserActionRevision(ref) !== expectedRevision) return false;
      if (request.kind !== "diff") {
        open(ref, request, true);
        return true;
      }
      const key = `${ref.environmentId}:${ref.threadId}`;
      if (proactiveDiffTurns.get(key) === request.turnId) return true;
      proactiveDiffTurns.set(key, request.turnId);
      open(ref, singletonSurface("diff"), true);
      return true;
    },
    open(ref, kind) {
      const existing =
        kind === "preview"
          ? controller
              .getPanes()
              .find((pane) => belongs(ref, pane) && toolPaneSurface(pane)?.kind === "preview")
          : null;
      open(
        ref,
        existing
          ? toolPaneSurface(existing)!
          : kind === "preview"
            ? browserSurface(null)
            : singletonSurface(kind),
      );
    },
    openBrowser: (ref, tabId, automatic = false) => open(ref, browserSurface(tabId), automatic),
    openDevice: (ref, target, automatic = false) => open(ref, deviceSurface(target), automatic),
    renameDevice: (ref, id, title) =>
      mutate(ref, id, (surface) =>
        surface.kind === "device" ? renameDeviceSurface(surface, title) : surface,
      ),
    openFile(ref, requestedPath, line) {
      const surfaces = controller.getPanes().flatMap((pane) => {
        const surface = belongs(ref, pane) && !isPaneClosing(pane.paneId) && toolPaneSurface(pane);
        return surface ? [surface] : [];
      });
      open(ref, openFileSurface(requestedPath, line, surfaces));
    },
    openAttachment: (ref, attachment) => open(ref, attachmentSurface(attachment)),
    openPullRequest: (ref, target) => open(ref, pullRequestSurface(target)),
    openTerminal: (ref, terminalId) => open(ref, terminalSurface(terminalId)),
    splitTerminal: (ref, id, terminalId, direction = "horizontal") =>
      mutate(ref, id, (surface) =>
        surface.kind === "terminal"
          ? splitTerminalSurface(surface, terminalId, direction)
          : surface,
      ),
    activateTerminal: (ref, id, terminalId) =>
      mutate(ref, id, (surface) =>
        surface.kind === "terminal" && surface.terminalIds.includes(terminalId)
          ? { ...surface, activeTerminalId: terminalId }
          : surface,
      ),
    closeTerminal(ref, id, terminalId) {
      const pane = find(ref, id);
      const surface = pane && toolPaneSurface(pane);
      if (surface?.kind !== "terminal") return;
      const remaining = closeTerminalSurface(surface, terminalId);
      if (remaining === null) closeSurface(ref, id);
      else mutate(ref, id, () => remaining);
    },
    closeSurface,
    close(ref) {
      const source = controller
        .getPanes()
        .find((pane) => pane.paneId === sourcePaneId && belongs(ref, pane));
      if (source) {
        controller.recordUserAction(ref);
        controller.remove(source.paneId);
      }
    },
  };
}

export function useSpatialSurfaceNavigation(
  controller: ToolPaneController,
  sourcePaneId: string,
  focusPane: (paneId: string) => void,
  isPaneClosing: (paneId: string) => boolean = isNeverClosing,
) {
  const { getPanes, openSurface, updateSurface, remove, getUserActionRevision, recordUserAction } =
    controller;
  return useMemo(
    () =>
      createSpatialSurfaceNavigation(
        {
          getPanes,
          openSurface,
          updateSurface,
          remove,
          getUserActionRevision,
          recordUserAction,
        },
        sourcePaneId,
        focusPane,
        isPaneClosing,
      ),
    [
      focusPane,
      isPaneClosing,
      getPanes,
      getUserActionRevision,
      openSurface,
      sourcePaneId,
      recordUserAction,
      remove,
      updateSurface,
    ],
  );
}

export function SpatialSurfaceHost({
  controller,
  paneId,
  focusPane,
  isPaneClosing,
  children,
}: {
  controller: ToolPaneController;
  paneId: string;
  focusPane: (paneId: string) => void;
  isPaneClosing?: (paneId: string) => boolean;
  children: ReactNode;
}) {
  const navigation = useSpatialSurfaceNavigation(controller, paneId, focusPane, isPaneClosing);
  return <SurfaceNavigationContext value={navigation}>{children}</SurfaceNavigationContext>;
}
