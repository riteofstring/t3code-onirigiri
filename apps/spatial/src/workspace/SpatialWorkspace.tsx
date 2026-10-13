import {
  OnirigiriWorkspace,
  createWorkspaceScene,
  defaultOnirigiriShortcuts,
  type OnirigiriShortcutBinding,
  type OnirigiriShortcutBindings,
  type OnirigiriWorkspaceProps,
  serializeWorkspaceLayout,
  type OnirigiriPaneRenderState,
  type OnirigiriWorkspaceHandle,
  type PaneSizingMode,
  type WorkspaceFocusedPaneFrame,
  type WorkspacePane,
} from "@riteofstring/onirigiri";
import "@riteofstring/onirigiri/styles.css";
import { useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { terminalEnvironment } from "@t3tools/web/src/state/terminal";
import { previewEnvironment } from "@t3tools/web/src/state/preview";
import { readThreadPreviewState } from "@t3tools/web/src/previewStateStore";
import { closePreviewSession } from "@t3tools/web/src/components/preview/closePreviewSession";
import { agentControlledBrowserCloseConfirmation } from "@t3tools/web/src/components/ChatView.logic";
import { LinkPullRequestDialogHost } from "@t3tools/web/src/components/pullRequest/LinkPullRequestDialog";
import { readLocalApi } from "@t3tools/web/src/localApi";
import { confirmTerminalClose } from "@t3tools/web/src/lib/terminalCloseConfirm";
import {
  BrowserSurfaceProjectionContext,
  type BrowserSurfaceProjectionPolicy,
} from "@t3tools/web/src/browser/browserSurfaceProjection";
import { useAtomCommand } from "@t3tools/web/src/state/use-atom-command";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { ToolPaneView } from "./ToolPaneView";
import { SpatialSurfaceHost } from "./SpatialSurfaceHost";
import { useSpatialController } from "./SpatialSurfaceProvider";
import { useFocusAnchorPreference } from "./FocusAnchorToggle";
import { WorkspaceTooltips, WorkspaceControlButton } from "./WorkspaceTooltips";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { overviewZoomChoices, useWorkspacePreferences } from "./useWorkspacePreferences";
import {
  readPaneLayout,
  createPaneLayoutPersistence,
  panesFillViewport,
  reconcilePaneLayout,
  threadLayoutPositions,
} from "./workspaceLayout";
import { PaneLifecycleContext, createPaneLifecycleStore } from "./paneLifecycle";
import { SavedPanePicture } from "./SavedPanePicture";
import { spatialBrowserOccluders } from "./spatialBrowserOccluders";
import { ThreadCard } from "./ThreadCard";
import { SpatialWorkspaceActiveContext, ThreadPane } from "./ThreadPane";
import { toolPaneSurface, type ToolPane } from "./useToolPanes";
import { PaneSnapshotContext, useSavedPanePictures } from "./useSavedPanePictures";
import {
  threadPaneId,
  useWorkspacePanes,
  type ThreadPaneData,
  type WorkspaceLayoutMode,
} from "./useWorkspacePanes";

const WORKSPACE_CHROME = { WorkspaceControlButton };
const WORKSPACE_ID = "onirigiri-t3";
const LAYOUT_MODE_KEY = "onirigiri-t3:layout-mode";

// Explicit arrow chords remain available while a pane owns keyboard focus.
function whileEditing(key: string) {
  return { altKey: true, ctrlKey: true, key, metaKey: false, shiftKey: false, whileEditing: true };
}
// New panes use T3's chooser; navigation and rearrangement use the engine.
const NAVIGATION = new Set([
  "focusDown",
  "focusFirstColumn",
  "focusLastColumn",
  "focusLeft",
  "focusRight",
  "focusUp",
  "movePaneDown",
  "movePaneLeft",
  "movePaneRight",
  "movePaneUp",
  "returnHome",
  "toggleOverview",
]);
const editingArrows = (bindings: readonly OnirigiriShortcutBinding[]) =>
  bindings.map((binding) => ({ ...binding, whileEditing: binding.key.startsWith("Arrow") }));
const SHORTCUTS: OnirigiriShortcutBindings = {
  ...Object.fromEntries(
    Object.keys(defaultOnirigiriShortcuts)
      .filter((action) => !NAVIGATION.has(action))
      .map((action) => [action, []]),
  ),
  focusDown: defaultOnirigiriShortcuts.focusDown,
  movePaneDown: editingArrows(defaultOnirigiriShortcuts.movePaneDown),
  focusLeft: defaultOnirigiriShortcuts.focusLeft,
  movePaneLeft: editingArrows(defaultOnirigiriShortcuts.movePaneLeft),
  focusRight: defaultOnirigiriShortcuts.focusRight,
  movePaneRight: editingArrows(defaultOnirigiriShortcuts.movePaneRight),
  focusUp: defaultOnirigiriShortcuts.focusUp,
  movePaneUp: editingArrows(defaultOnirigiriShortcuts.movePaneUp),
  toggleOverview: [...defaultOnirigiriShortcuts.toggleOverview, whileEditing("o")],
};
/** Quiet time after a focus change before the app route follows it. */
const ROUTE_SETTLE_MS = 450;

function readWorkspaceOptions() {
  const requested = new URLSearchParams(window.location.search).get("layout");
  let layout: WorkspaceLayoutMode = "rows";
  if (requested === "strip" || requested === "rows") layout = requested;
  else {
    try {
      if (localStorage.getItem(LAYOUT_MODE_KEY) === "strip") layout = "strip";
    } catch {
      // The explicit URL remains usable without browser storage.
    }
  }
  return { layout };
}

export function SpatialWorkspace({
  target,
  active,
}: {
  target: ThreadRouteTarget | null;
  /** False while a draft or another route covers the workspace. */
  active: boolean;
}) {
  const router = useRouter();
  const [{ layout: layoutMode }] = useState(readWorkspaceOptions);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_MODE_KEY, layoutMode);
    } catch {
      // Arrangement mode remains usable for this session.
    }
  }, [layoutMode]);
  const { controller: toolController, bindWorkspace } = useSpatialController();
  const { toolPanes, addEmpty, remove } = toolController;
  const closingToolPanesRef = useRef(new Set<string>());
  const [closingToolPanes, setClosingToolPanes] = useState<ReadonlySet<string>>(() => new Set());
  const isPaneClosing = useCallback(
    (paneId: string) => closingToolPanesRef.current.has(paneId),
    [],
  );
  const toolPanesRef = useRef(toolPanes);
  useEffect(() => {
    toolPanesRef.current = toolPanes;
  }, [toolPanes]);
  const [dismissedPaneIds, setDismissedPaneIds] = useState<ReadonlySet<string>>(() => new Set());
  const panes = useWorkspacePanes(layoutMode, toolPanes, dismissedPaneIds);
  const [initialPanes, setInitialPanes] = useState(panes);
  if (initialPanes === null && panes !== null) setInitialPanes(panes);
  const [preferences, updatePreferences] = useWorkspacePreferences();
  const paneDefaults = useMemo(() => ({ height: preferences.rowHeight }), [preferences.rowHeight]);
  const [savedLayout] = useState(() => readPaneLayout(layoutMode));
  const initialLayout = useMemo(() => {
    if (!initialPanes) return null;
    const fresh = createWorkspaceScene({
      id: WORKSPACE_ID,
      panes: initialPanes,
      paneDefaults,
      gridAxes: layoutMode === "strip" ? "horizontal" : "spatial",
    });
    const layout = serializeWorkspaceLayout(fresh.scene, fresh.cursor);
    return savedLayout ? reconcilePaneLayout(layout, savedLayout) : layout;
  }, [initialPanes, layoutMode, paneDefaults, savedLayout]);
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  const [focusAnchor, toggleFocusAnchor] = useFocusAnchorPreference();
  const overviewCardWidth = overviewZoomChoices.find(
    (choice) => choice.value === preferences.overviewZoom,
  )?.width;
  const [panesMaximized, setPanesMaximized] = useState(false);
  const [workspacePadding, setWorkspacePadding] = useState(0);
  const resizePanes = useCallback((mode: PaneSizingMode) => {
    workspaceRef.current?.resizePanes(mode);
  }, []);
  const [controlsContainer, setControlsContainer] = useState<HTMLDivElement | null>(null);
  const getLayout = useCallback(() => workspaceRef.current?.getLayout() ?? null, []);
  const [lifecycle, setLifecycle] = useState<ReturnType<typeof createPaneLifecycleStore> | null>(
    null,
  );
  const onSnapshotFailure = useCallback(
    (paneId: string, startedAt: number) => lifecycle?.pictureFailed(paneId, startedAt),
    [lifecycle],
  );
  const {
    getPanePicture,
    getPanePresentation,
    onLayoutChange: onPictureLayoutChange,
    onPanePictureCaptured,
    pictureFor,
    preparedPictureUrl,
    pictureUrl,
    hasFreshPicture,
    canBackgroundPicture,
    runningPanes,
    retainedPaneIds,
    picturesLoaded,
    paneSnapshots,
    setCaptureActivity,
    stageRef,
    stageViewport,
  } = useSavedPanePictures(getLayout, onSnapshotFailure, preferences.rowHeight);
  const paneViewport = useMemo(() => {
    if (stageViewport.height <= 0) return null;
    return {
      width: Math.max(0, stageViewport.width - workspacePadding * 2),
      height: Math.max(0, stageViewport.height - workspacePadding * 2),
    };
  }, [stageViewport, workspacePadding]);
  const updatePaneSizing = useCallback(
    (layout: ReturnType<OnirigiriWorkspaceHandle["getLayout"]>) => {
      setPanesMaximized(paneViewport !== null && panesFillViewport(layout, paneViewport));
    },
    [paneViewport],
  );
  useEffect(() => {
    const layout = workspaceRef.current?.getLayout();
    if (layout) updatePaneSizing(layout);
  }, [updatePaneSizing]);
  const lastLayoutRevisionRef = useRef<number | null>(null);
  const layoutPersistence = useMemo(() => createPaneLayoutPersistence(layoutMode), [layoutMode]);
  useEffect(() => {
    window.addEventListener("pagehide", layoutPersistence.flush);
    return () => {
      window.removeEventListener("pagehide", layoutPersistence.flush);
      layoutPersistence.flush();
    };
  }, [layoutPersistence]);
  const onLayoutChange = useCallback<NonNullable<OnirigiriWorkspaceProps["onLayoutChange"]>>(
    (layout, metadata) => {
      layoutPersistence.save(layout);
      if (lastLayoutRevisionRef.current === metadata.layoutRevision) return;
      lastLayoutRevisionRef.current = metadata.layoutRevision;
      setWorkspacePadding(workspaceRef.current?.getScene().padding ?? 0);
      updatePaneSizing(layout);
      onPictureLayoutChange(layout);
      lifecycle?.setPanes(threadLayoutPositions(layout));
    },
    [layoutPersistence, lifecycle, onPictureLayoutChange, updatePaneSizing],
  );

  // Focus is kept out of React state so moving between panes does not
  // re-render the workspace.
  const focusedPaneIdRef = useRef<string | null>(null);
  // A pane just added, focused once the arrangement includes it.
  const pendingFocusPaneIdRef = useRef<string | null>(null);

  const paneData = useMemo(() => {
    const byPaneId = new Map<string, ThreadPaneData>();
    for (const pane of panes ?? []) {
      const data = pane.data as ThreadPaneData;
      byPaneId.set(threadPaneId(data.environmentId, data.threadId), data);
    }
    return byPaneId;
  }, [panes]);
  const panesRef = useRef(panes);
  const activeRef = useRef(active);
  const browserProjection = useMemo<BrowserSurfaceProjectionPolicy>(
    () => ({
      canPresent: (slot) =>
        !slot.closest(
          '[data-onirigiri-slot="pane"][data-visible="false"], [data-onirigiri-slot="pane-content"][data-runtime-state="hidden"]',
        ),
      occluders: spatialBrowserOccluders,
      interactive: (slot) =>
        !slot.closest('[data-onirigiri-shielded="true"], [data-runtime-state="frozen"]'),
      focus: (slot) => {
        // Use the same focus-without-camera-movement path as native pane content.
        slot.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
        );
      },
    }),
    [],
  );

  const routePaneId =
    target?.kind === "server"
      ? threadPaneId(target.threadRef.environmentId, target.threadRef.threadId)
      : null;

  if (lifecycle === null && initialLayout !== null) {
    setLifecycle(createPaneLifecycleStore(threadLayoutPositions(initialLayout), routePaneId));
  }

  // Panes appearing, leaving or moving rebuild the arrangement around the
  // focused pane; renames and an empty pane's choice change panes in place.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!panes || !workspace) return;
    const previous = panesRef.current;
    panesRef.current = panes;
    if (!previous || previous === panes) return;
    const previousById = new Map(previous.map((pane) => [pane.paneId, pane]));
    if (panes.length !== previous.length || panes.some((pane) => !previousById.has(pane.paneId))) {
      const { scene } = createWorkspaceScene({
        gridAxes: layoutMode === "strip" ? "horizontal" : "spatial",
        id: WORKSPACE_ID,
        paneDefaults,
        panes,
      });
      const selectedId = workspace.getSnapshot().focusedPaneId;
      const previousSelected = selectedId ? previousById.get(selectedId) : undefined;
      const removedTool =
        previousSelected?.surfaceKind !== "thread" && previousSelected?.data
          ? (previousSelected.data as ToolPane)
          : null;
      const focused =
        panes.find((pane) => pane.paneId === pendingFocusPaneIdRef.current) ??
        panes.find((pane) => pane.paneId === selectedId) ??
        (removedTool
          ? panes.find(
              (pane) =>
                pane.paneId === threadPaneId(removedTool.environmentId, removedTool.threadId),
            )
          : undefined);
      const added = panes.some((pane) => pane.paneId === pendingFocusPaneIdRef.current)
        ? pendingFocusPaneIdRef.current
        : null;
      pendingFocusPaneIdRef.current = null;
      const layout = serializeWorkspaceLayout(scene, {
        column: focused?.slotIndex ?? 0,
        row: focused?.planeIndex ?? 0,
        split: 0,
      });
      workspace.restoreLayout(reconcilePaneLayout(layout, workspace.getLayout(), focused?.paneId), {
        keepPresentation: true,
      });
      // A pane just added is for using now: leave overview to show it.
      if (added && workspace.getSnapshot().presentationMode === "overview") {
        workspace.focusPane(added, { exitOverview: true });
      }
      return;
    }
    for (const pane of panes) {
      const before = previousById.get(pane.paneId);
      // An empty pane the user turned into a terminal or diff changes in place.
      if (before && before.surfaceKind !== pane.surfaceKind) {
        workspace.configurePane(pane.paneId, {
          data: pane.data,
          surfaceKind: pane.surfaceKind,
          title: pane.title,
        });
      } else if (pane.title && before?.title !== pane.title) {
        workspace.renamePane(pane.paneId, pane.title);
      }
    }
  }, [layoutMode, paneDefaults, panes]);

  useEffect(() => () => lifecycle?.dispose(), [lifecycle]);
  useLayoutEffect(() => {
    lifecycle?.setRetainedPanes(retainedPaneIds);
  }, [lifecycle, retainedPaneIds]);
  useEffect(() => {
    lifecycle?.setPictures(hasFreshPicture, picturesLoaded, canBackgroundPicture);
  }, [hasFreshPicture, lifecycle, picturesLoaded, canBackgroundPicture]);
  useEffect(() => {
    lifecycle?.setRunning(active ? runningPanes : new Set());
  }, [active, lifecycle, runningPanes]);
  // Preparation and snapshot drawing explicitly lay out offscreen content.
  // Covered workspaces have no measurable viewport and must not start captures.
  useEffect(() => {
    lifecycle?.setBackgroundPictures(active);
    setCaptureActivity(active, lifecycle?.isMoving() ?? false);
  }, [active, lifecycle, setCaptureActivity]);

  // The app route follows the focused thread once the camera rests, so T3's
  // global surfaces act on it. Routes this workspace requested are remembered
  // so they are not mistaken for a navigation elsewhere in the app, which
  // instead moves focus to its pane.
  const requestedRoutesRef = useRef(new Set<string>());
  const pendingNavigationPaneRef = useRef<string | null>(null);
  const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRouteRef = useRef<(() => void) | null>(null);
  const routePaneIdRef = useRef(routePaneId);
  // A route change made elsewhere, or covering the workspace, supersedes a
  // pending follow of the camera; one this workspace asked for earlier does not.
  useEffect(() => {
    const coveredChanged = activeRef.current !== active;
    routePaneIdRef.current = routePaneId;
    if (pendingNavigationPaneRef.current === routePaneId) pendingNavigationPaneRef.current = null;
    activeRef.current = active;
    const requested = routePaneId !== null && requestedRoutesRef.current.has(routePaneId);
    if (!coveredChanged && requested) return;
    if (routeTimerRef.current !== null) {
      clearTimeout(routeTimerRef.current);
      routeTimerRef.current = null;
    }
    pendingRouteRef.current = null;
  }, [routePaneId, active]);
  useEffect(
    () => () => {
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
    },
    [],
  );

  const onFocusedPaneFrame = useCallback(
    (frame: WorkspaceFocusedPaneFrame | null, moving: boolean) => {
      setCaptureActivity(activeRef.current, moving);
      lifecycle?.setMoving(activeRef.current && moving);
      const paneId = frame?.paneId ?? workspaceRef.current?.getSnapshot().focusedPaneId ?? null;
      if (paneId === focusedPaneIdRef.current || !activeRef.current) return;
      focusedPaneIdRef.current = paneId;
      if (paneId === null) {
        lifecycle?.setFocus(null);
        return;
      }
      // A terminal or diff pane acts for its thread, which the route follows.
      const tool = toolPanesRef.current.find((pane) => pane.paneId === paneId);
      const routeTarget = tool ? threadPaneId(tool.environmentId, tool.threadId) : paneId;
      if (pendingNavigationPaneRef.current !== routeTarget) pendingNavigationPaneRef.current = null;
      const data = paneData.get(routeTarget);
      if (!data) return;
      if (!tool) lifecycle?.setFocus(paneId);
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
      const follow = () => {
        if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
        routeTimerRef.current = null;
        pendingRouteRef.current = null;
        if (
          routeTarget === routePaneIdRef.current ||
          routeTarget === pendingNavigationPaneRef.current ||
          focusedPaneIdRef.current !== paneId
        )
          return;
        requestedRoutesRef.current.add(routeTarget);
        void router.navigate({ to: "/$environmentId/$threadId", params: data });
      };
      pendingRouteRef.current = follow;
      routeTimerRef.current = setTimeout(follow, ROUTE_SETTLE_MS);
    },
    [lifecycle, paneData, router, setCaptureActivity],
  );

  // Anything but moving on through the workspace, such as opening the command
  // palette or clicking, may act on the focused thread, so a route still
  // waiting for the camera follows it at once.
  useEffect(() => {
    const followNow = (event: Event) => {
      const follow = pendingRouteRef.current;
      if (!follow) return;
      if (event instanceof KeyboardEvent) {
        const modifierOnly = ["Alt", "Control", "Meta", "Shift"].includes(event.key);
        const navigating = event.altKey && (event.key.startsWith("Arrow") || event.code === "KeyO");
        if (modifierOnly || navigating) return;
      }
      follow();
    };
    window.addEventListener("keydown", followNow, true);
    window.addEventListener("pointerdown", followNow, true);
    return () => {
      window.removeEventListener("keydown", followNow, true);
      window.removeEventListener("pointerdown", followNow, true);
    };
  }, []);

  // Focus moved while the workspace was covered, as when a route it did not
  // request focused a pane, reaches the lifecycle once it shows again.
  useEffect(() => {
    if (!lifecycle) return;
    if (!active) {
      lifecycle.setMoving(false);
      return;
    }
    const paneId = workspaceRef.current?.getSnapshot().focusedPaneId;
    if (paneId && paneId !== focusedPaneIdRef.current && paneData.has(paneId)) {
      focusedPaneIdRef.current = paneId;
      lifecycle.setFocus(paneId);
    }
  }, [active, lifecycle, paneData]);

  // A route the workspace did not request (the sidebar, a notification, a new
  // thread) moves focus to its pane, leaving overview. A thread whose pane is
  // not in the workspace yet is focused once reconciliation adds it.
  const pendingRoutePaneRef = useRef<string | null>(null);
  const focusRoutePane = useEffectEvent((paneId: string) => {
    if (requestedRoutesRef.current.delete(paneId)) return;
    setDismissedPaneIds((current) => {
      if (!current.has(paneId)) return current;
      const next = new Set(current);
      next.delete(paneId);
      return next;
    });
    if (!panes?.some((pane) => pane.paneId === paneId)) {
      pendingRoutePaneRef.current = paneId;
      return;
    }
    pendingRoutePaneRef.current = null;
    workspaceRef.current?.focusPane(paneId, { exitOverview: true });
  });

  useEffect(() => {
    if (routePaneId) focusRoutePane(routePaneId);
  }, [routePaneId]);

  // Explicit navigation starts camera motion before the route finishes loading.
  // Routes requested by pane navigation retain their follow-up guard.
  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", (event) => {
        const match = router
          .matchRoutes(event.toLocation)
          .find((routeMatch) => routeMatch.routeId === "/_chat/$environmentId/$threadId");
        const params = match?.params as { environmentId?: string; threadId?: string } | undefined;
        if (params?.environmentId && params.threadId) {
          const paneId = threadPaneId(params.environmentId, params.threadId);
          if (!requestedRoutesRef.current.has(paneId)) {
            pendingNavigationPaneRef.current = paneId === routePaneIdRef.current ? null : paneId;
            focusRoutePane(paneId);
          }
        } else {
          pendingNavigationPaneRef.current = null;
        }
      }),
    [router],
  );

  useEffect(() => {
    const pending = pendingRoutePaneRef.current;
    if (pending && panes?.some((pane) => pane.paneId === pending)) focusRoutePane(pending);
  }, [panes]);

  useEffect(() => {
    if (!active) return;
    const confirmOverview = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "button, a, input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']",
        )
      )
        return;
      const workspace = workspaceRef.current;
      const snapshot = workspace?.getSnapshot();
      if (snapshot?.presentationMode !== "overview" || !snapshot.focusedPaneId) return;
      event.preventDefault();
      workspace?.focusPane(snapshot.focusedPaneId, { exitOverview: true });
    };
    window.addEventListener("keydown", confirmOverview);
    return () => window.removeEventListener("keydown", confirmOverview);
  }, [active]);

  const navigateAway = useCallback(
    (href: string) => {
      void router.navigate({ href });
    },
    [router],
  );

  // A new empty pane opens beside the focused pane, for its thread.
  const addPaneBeside = useCallback(
    (paneId: string | null) => {
      const thread = paneId ? paneData.get(paneId) : undefined;
      const tool = toolPanes.find((pane) => pane.paneId === paneId);
      const owner = thread ?? tool;
      if (!owner) return;
      pendingFocusPaneIdRef.current = addEmpty(
        { environmentId: owner.environmentId, threadId: owner.threadId },
        tool?.paneId ?? null,
      );
    },
    [addEmpty, paneData, toolPanes],
  );
  const addPane = useCallback(() => addPaneBeside(focusedPaneIdRef.current), [addPaneBeside]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyN" || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.shiftKey || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))
      ) {
        return;
      }
      event.preventDefault();
      addPane();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, addPane]);

  const closeTerminal = useAtomCommand(terminalEnvironment.close, "terminal close");
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const onPaneClose = useCallback(
    async (pane: WorkspacePane) => {
      const tool = toolController.getPanes().find((candidate) => candidate.paneId === pane.paneId);
      if (!tool) {
        if (pane.surfaceKind !== "thread") return false;
        setDismissedPaneIds((current) => new Set([...current, pane.paneId]));
        return false;
      }
      if (isPaneClosing(tool.paneId)) return false;
      closingToolPanesRef.current.add(tool.paneId);
      setClosingToolPanes(new Set(closingToolPanesRef.current));
      toolController.recordUserAction(tool);
      try {
        const surface = toolPaneSurface(tool);
        if (surface?.kind === "terminal") {
          if (
            !(await confirmTerminalClose([
              surface.activeTerminalId,
              ...surface.terminalIds.filter((id) => id !== surface.activeTerminalId),
            ]))
          )
            return false;
          for (const terminalId of surface.terminalIds) {
            const closed = await closeTerminal({
              environmentId: tool.environmentId,
              input: { threadId: tool.threadId, terminalId, deleteHistory: true },
            });
            if (closed._tag !== "Success") return false;
            toolController.updateSurface(tool.paneId, (current) => {
              if (current.kind !== "terminal") return current;
              const remaining = current.terminalIds.filter((id) => id !== terminalId);
              return {
                ...current,
                terminalIds: remaining,
                activeTerminalId: remaining.includes(current.activeTerminalId)
                  ? current.activeTerminalId
                  : (remaining[0] ?? current.activeTerminalId),
              };
            });
          }
        }
        if (surface?.kind === "preview" && surface.resourceId) {
          const preview = readThreadPreviewState(tool);
          const confirmation = agentControlledBrowserCloseConfirmation(
            [surface],
            preview.desktopByTabId,
          );
          if (
            confirmation &&
            !(await readLocalApi()?.dialogs.confirm(confirmation, { variant: "destructive" }))
          )
            return false;
          const closed = await closePreviewSession({
            closePreview,
            threadRef: tool,
            tabId: surface.resourceId,
            snapshot: preview.sessions[surface.resourceId] ?? null,
          });
          if (closed._tag !== "Success") return false;
        }
        // The rebuilt arrangement drops the pane, so the workspace does not
        // close it itself; focus returns to its thread.
        pendingFocusPaneIdRef.current = threadPaneId(tool.environmentId, tool.threadId);
        remove(tool.paneId);
        return false;
      } finally {
        closingToolPanesRef.current.delete(tool.paneId);
        setClosingToolPanes(new Set(closingToolPanesRef.current));
      }
    },
    [closePreview, closeTerminal, isPaneClosing, remove, toolController],
  );

  const navigateFromTerminal = useCallback<OnirigiriWorkspaceHandle["focus"]>(
    (direction) => workspaceRef.current?.focus(direction) ?? false,
    [],
  );

  const closeChatPane = useCallback((paneId: string) => {
    void workspaceRef.current?.closePane(paneId);
  }, []);
  const togglePaneMaximized = useCallback((paneId: string) => {
    workspaceRef.current?.togglePaneMaximized(paneId);
  }, []);
  const focusSurfacePane = useCallback((paneId: string) => {
    if (workspaceRef.current?.focusPane(paneId, { exitOverview: true })) return;
    pendingFocusPaneIdRef.current = paneId;
    setDismissedPaneIds((current) => {
      if (!current.has(paneId)) return current;
      const next = new Set(current);
      next.delete(paneId);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!active || !initialPanes || !lifecycle || !workspaceRef.current) return;
    bindWorkspace({ focusPane: focusSurfacePane, isPaneClosing });
    return () => bindWorkspace(null);
  }, [active, bindWorkspace, focusSurfacePane, initialPanes, isPaneClosing, lifecycle]);

  const renderPane = useCallback(
    (pane: WorkspacePane, state: OnirigiriPaneRenderState) => {
      if (pane.surfaceKind === "empty-frame") {
        return (
          <div className="p-6 text-sm text-muted-foreground">
            Choose a chat in the sidebar to reopen it.
          </div>
        );
      }
      if (pane.surfaceKind !== "thread") {
        const tool =
          toolPanes.find((candidate) => candidate.paneId === pane.paneId) ??
          (pane.data as ToolPane);
        return (
          <SpatialSurfaceHost
            controller={toolController}
            paneId={pane.paneId}
            focusPane={focusSurfacePane}
            isPaneClosing={isPaneClosing}
          >
            <div className="h-full min-h-0" inert={closingToolPanes.has(pane.paneId)}>
              <ToolPaneView
                pane={tool}
                isPresent={() =>
                  !isPaneClosing(tool.paneId) &&
                  toolController.getPanes().some((candidate) => candidate.paneId === tool.paneId)
                }
                focused={state.focused && active && !closingToolPanes.has(pane.paneId)}
                visible={state.visible && active}
                onNavigate={navigateFromTerminal}
                onClose={() => void workspaceRef.current?.closePane(pane.paneId)}
                onFocusThread={() =>
                  focusSurfacePane(threadPaneId(tool.environmentId, tool.threadId))
                }
              />
            </div>
          </SpatialSurfaceHost>
        );
      }
      return (
        <SpatialSurfaceHost
          controller={toolController}
          paneId={pane.paneId}
          focusPane={focusSurfacePane}
          isPaneClosing={isPaneClosing}
        >
          <ThreadPane
            thread={pane.data as ThreadPaneData}
            focused={state.focused}
            visible={state.visible}
            paneId={pane.paneId}
            onNavigateAway={navigateAway}
            maximized={state.maximized}
            onAddPane={addPaneBeside}
            onClosePane={closeChatPane}
            onToggleMaximized={togglePaneMaximized}
          />
        </SpatialSurfaceHost>
      );
    },
    [
      active,
      addPaneBeside,
      closeChatPane,
      closingToolPanes,
      focusSurfacePane,
      isPaneClosing,
      navigateAway,
      navigateFromTerminal,
      togglePaneMaximized,
      toolController,
      toolPanes,
    ],
  );

  // A valid picture remains a visual cover while the same thread refreshes.
  const renderPanePlaceholder = useCallback(
    (pane: WorkspacePane) => {
      if (pane.surfaceKind !== "thread") return null;
      const data = pane.data as ThreadPaneData;
      const card = <ThreadCard environmentId={data.environmentId} threadId={data.threadId} />;
      const picture = pictureFor(pane.paneId);
      return picture ? (
        <SavedPanePicture
          image={picture.image}
          cssSize={picture.cssSize}
          preparedUrl={preparedPictureUrl(picture.image)}
          pictureUrl={pictureUrl}
          summary={card}
        />
      ) : (
        card
      );
    },
    [pictureFor, pictureUrl, preparedPictureUrl],
  );

  return (
    <WorkspaceTooltips>
      <LinkPullRequestDialogHost />
      <div
        ref={stageRef}
        inert={!active}
        className="spatial-workspace relative flex h-full w-full flex-col"
      >
        <WorkspaceToolbar
          focusAnchor={focusAnchor}
          onAdd={addPane}
          onToggleAnchor={toggleFocusAnchor}
          preferences={preferences}
          maxRowHeight={
            stageViewport.compact ? stageViewport.height : (paneViewport?.height ?? null)
          }
          onPreferencesChange={updatePreferences}
          onResizePanes={resizePanes}
          panesMaximized={panesMaximized}
          controlsRef={setControlsContainer}
          shortcuts={SHORTCUTS}
        />
        {initialPanes && lifecycle ? (
          <SpatialWorkspaceActiveContext value={active}>
            <PaneLifecycleContext value={lifecycle}>
              <PaneSnapshotContext value={paneSnapshots}>
                <BrowserSurfaceProjectionContext value={browserProjection}>
                  <OnirigiriWorkspace
                    ref={workspaceRef}
                    ariaLabel="Onirigiri for T3 Code"
                    className="min-h-0 flex-1"
                    chromeComponents={WORKSPACE_CHROME}
                    {...(layoutMode === "strip" ? { cursorRunway: 0 } : {})}
                    cursorTargets={layoutMode === "strip" ? "panes" : "cells"}
                    desktopControlsContainer={controlsContainer}
                    focusAnchor={focusAnchor}
                    getPanePicture={getPanePicture}
                    getPanePresentation={getPanePresentation}
                    gridAxes={layoutMode === "strip" ? "horizontal" : "spatial"}
                    initialPanes={initialPanes}
                    initialLayout={initialLayout}
                    liveContent
                    onFocusedPaneFrame={onFocusedPaneFrame}
                    onLayoutChange={onLayoutChange}
                    onPaneClose={onPaneClose}
                    onPanePictureCaptured={onPanePictureCaptured}
                    {...(overviewCardWidth === undefined
                      ? {}
                      : {
                          overviewCardMaxWidthPx: overviewCardWidth,
                          overviewCardMinWidthPx: overviewCardWidth,
                        })}
                    paneDefaults={paneDefaults}
                    renderPane={renderPane}
                    renderPanePlaceholder={renderPanePlaceholder}
                    restPictureFade
                    shortcutScope={active ? "application" : "workspace"}
                    shortcuts={SHORTCUTS}
                    workspaceId={WORKSPACE_ID}
                  />
                </BrowserSurfaceProjectionContext>
              </PaneSnapshotContext>
            </PaneLifecycleContext>
          </SpatialWorkspaceActiveContext>
        ) : null}
      </div>
    </WorkspaceTooltips>
  );
}
