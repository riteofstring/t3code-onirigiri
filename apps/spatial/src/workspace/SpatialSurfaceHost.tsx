import type { ScopedThreadRef } from "@t3tools/contracts";
import { type ReactNode, useMemo } from "react";
import {
  attachmentSurface,
  browserSurface,
  deviceSurface,
  fileSurface,
  pullRequestSurface,
  singletonSurface,
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
    if (automatic && find(ref, surface.id)) return;
    if (!automatic) {
      controller.recordUserAction(ref);
      const players = usePreviewMiniPlayerStore.getState();
      const floating = selectThreadPreviewMiniPlayer(players.byThreadKey, ref);
      if (floating && previewMiniPlayerSourceKey(floating.source) === surface.id)
        players.close(ref);
    }
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
    openProactive(ref, surface, expectedRevision) {
      if (controller.getUserActionRevision(ref) !== expectedRevision) return false;
      open(ref, surface, true);
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
    openBrowser: (ref, tabId) => open(ref, browserSurface(tabId)),
    openDevice: (ref, target, automatic = false) => open(ref, deviceSurface(target), automatic),
    renameDevice: (ref, id, title) =>
      mutate(ref, id, (surface) =>
        surface.kind === "device"
          ? { ...surface, title: title.trim() || surface.target?.name || "Device" }
          : surface,
      ),
    openFile(ref, requestedPath, line) {
      if (requestedPath === ".") {
        open(ref, singletonSurface("files"));
        return;
      }
      const path = /^[A-Za-z]:\/+$/u.test(requestedPath)
        ? requestedPath
        : requestedPath.replace(/\/+$/u, "") || requestedPath;
      const existing = find(ref, `file:${path}`);
      const surface = existing && toolPaneSurface(existing);
      open(
        ref,
        fileSurface(
          path,
          line !== undefined && Number.isFinite(line) ? Math.max(1, Math.trunc(line)) : null,
          (surface?.kind === "file" ? surface.revealRequestId : 0) + 1,
        ),
      );
    },
    openAttachment: (ref, attachment) => open(ref, attachmentSurface(attachment)),
    openPullRequest: (ref, target) => open(ref, pullRequestSurface(target)),
    openTerminal: (ref, terminalId) => open(ref, terminalSurface(terminalId)),
    splitTerminal: (ref, id, terminalId, direction = "horizontal") =>
      mutate(ref, id, (surface) =>
        surface.kind === "terminal"
          ? {
              ...surface,
              terminalIds: [...new Set([...surface.terminalIds, terminalId])],
              activeTerminalId: terminalId,
              splitDirection: direction,
            }
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
      const remaining = surface.terminalIds.filter((id) => id !== terminalId);
      if (!remaining.length) closeSurface(ref, id);
      else
        mutate(ref, id, () => ({
          ...surface,
          terminalIds: remaining,
          activeTerminalId: remaining.includes(surface.activeTerminalId)
            ? surface.activeTerminalId
            : remaining[0]!,
        }));
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

export function SpatialSurfaceHost({
  controller,
  paneId,
  focusPane,
  isPaneClosing = isNeverClosing,
  children,
}: {
  controller: ToolPaneController;
  paneId: string;
  focusPane: (paneId: string) => void;
  isPaneClosing?: (paneId: string) => boolean;
  children: ReactNode;
}) {
  const { getPanes, openSurface, updateSurface, remove, getUserActionRevision, recordUserAction } =
    controller;
  const navigation = useMemo(
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
        paneId,
        focusPane,
        isPaneClosing,
      ),
    [
      focusPane,
      isPaneClosing,
      getPanes,
      getUserActionRevision,
      openSurface,
      paneId,
      recordUserAction,
      remove,
      updateSurface,
    ],
  );
  return <SurfaceNavigationContext value={navigation}>{children}</SurfaceNavigationContext>;
}
