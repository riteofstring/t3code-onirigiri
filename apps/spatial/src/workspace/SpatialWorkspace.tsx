import {
  OnirigiriWorkspace,
  createWorkspaceScene,
  defaultOnirigiriShortcuts,
  getOnirigiriShortcutBindings,
  type OnirigiriShortcutAction,
  type OnirigiriShortcutBinding,
  type OnirigiriShortcutBindings,
  type OnirigiriWorkspaceProps,
  serializeWorkspaceLayout,
  type OnirigiriPaneRenderState,
  type OnirigiriWorkspaceHandle,
  type WorkspaceFocusedPaneFrame,
  type WorkspacePane,
} from "@riteofstring/onirigiri";
import "@riteofstring/onirigiri/styles.css";
import { useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { terminalEnvironment } from "@t3tools/web/src/state/terminal";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useWorkspaceFocusedThreadStore } from "@t3tools/web/src/workspaceFocusedThreadStore";
import { closeTerminalSurface } from "@t3tools/web/src/rightPanelStore";
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
import { useComposerDraftStore, type DraftId } from "@t3tools/web/src/composerDraftStore";
import { useNewThreadHandler } from "@t3tools/web/src/hooks/useHandleNewThread";
import { readThreadShell } from "@t3tools/web/src/state/entities";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useThreadShells } from "@t3tools/web/src/state/entities";

import { ToolPaneView } from "./ToolPaneView";
import { SpatialSurfaceHost } from "./SpatialSurfaceHost";
import { useSpatialController } from "./SpatialSurfaceProvider";
import { WorkspaceTooltips, WorkspaceControlButton } from "./WorkspaceTooltips";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import {
  overviewZoomChoices,
  useFocusAnchorPreference,
  useLayoutModePreference,
  useWorkspacePreferences,
  type WorkspacePreferences,
} from "./useWorkspacePreferences";
import {
  readPaneLayout,
  createPaneLayoutPersistence,
  reconcilePaneLayout,
  threadLayoutPositions,
  placePane,
  type PanePlacement,
} from "./workspaceLayout";
import { PaneLifecycleContext, createPaneLifecycleStore } from "./paneLifecycle";
import { SavedPanePicture } from "./SavedPanePicture";
import { spatialBrowserOccluders } from "./spatialBrowserOccluders";
import { ThreadCard } from "./ThreadCard";
import { SpatialWorkspaceActiveContext, ThreadPane } from "./ThreadPane";
import { toolPaneSurface, type ToolPane } from "./useToolPanes";
import { FullScreenBorder, useFullScreenBorder } from "./FullScreenBorder";
import { useFullScreenTransition } from "./useFullScreenTransition";
import { PaneSnapshotContext, useSavedPanePictures } from "./useSavedPanePictures";
import {
  draftPaneId,
  threadPaneId,
  useWorkspacePanes,
  type ThreadPaneData,
  type WorkspaceDraft,
  type WorkspaceLayoutMode,
} from "./useWorkspacePanes";
import { DraftPane } from "./DraftPane";
import { EmptySpotGrid, useEmptySpots, type EmptySpot } from "./EmptySpotPanes";

import { installComposerNavigation } from "./composerNavigation";

const WORKSPACE_CHROME = { WorkspaceControlButton };
const WORKSPACE_ID = "onirigiri-t3";
const COMPACT_STAGE_WIDTH = 640;
const SNAP_CAMERA = { navigation: { durationMs: 0 } };

function whileEditing(key: string) {
  return { altKey: true, ctrlKey: true, key, metaKey: false, shiftKey: false, whileEditing: true };
}
function optionWhileEditing(key: string) {
  return { altKey: true, ctrlKey: false, key, metaKey: false, shiftKey: false, whileEditing: true };
}
function shiftOption(key: string) {
  return { altKey: true, ctrlKey: false, key, metaKey: false, shiftKey: true, whileEditing: false };
}
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
  focusDown: [...defaultOnirigiriShortcuts.focusDown, shiftOption("ArrowDown")],
  movePaneDown: editingArrows(defaultOnirigiriShortcuts.movePaneDown),
  focusLeft: [...defaultOnirigiriShortcuts.focusLeft, shiftOption("ArrowLeft")],
  movePaneLeft: editingArrows(defaultOnirigiriShortcuts.movePaneLeft),
  focusRight: [...defaultOnirigiriShortcuts.focusRight, shiftOption("ArrowRight")],
  movePaneRight: editingArrows(defaultOnirigiriShortcuts.movePaneRight),
  focusUp: [...defaultOnirigiriShortcuts.focusUp, shiftOption("ArrowUp")],
  movePaneUp: editingArrows(defaultOnirigiriShortcuts.movePaneUp),
  toggleOverview: [optionWhileEditing("o"), whileEditing("o")],
};
const BROWSER_SHORTCUTS = (
  Object.keys(defaultOnirigiriShortcuts) as OnirigiriShortcutAction[]
).flatMap((action) =>
  getOnirigiriShortcutBindings(action, SHORTCUTS).map((binding) =>
    action.startsWith("focus") && binding.shiftKey ? { ...binding, whileEditing: true } : binding,
  ),
);
const ROUTE_SETTLE_MS = 450;

function withoutPane(paneIds: ReadonlySet<string>, paneId: string) {
  if (!paneIds.has(paneId)) return paneIds;
  const next = new Set(paneIds);
  next.delete(paneId);
  return next;
}

export function SpatialWorkspace({
  target,
  active,
}: {
  target: ThreadRouteTarget | null;
  active: boolean;
}) {
  const [layoutMode, setLayoutMode] = useLayoutModePreference();
  return (
    <SpatialWorkspaceView
      key={layoutMode}
      target={target}
      active={active}
      layoutMode={layoutMode}
      onLayoutModeChange={setLayoutMode}
    />
  );
}

function SpatialWorkspaceView({
  target,
  active,
  layoutMode,
  onLayoutModeChange,
}: {
  target: ThreadRouteTarget | null;
  active: boolean;
  layoutMode: WorkspaceLayoutMode;
  onLayoutModeChange: (mode: WorkspaceLayoutMode) => void;
}) {
  const alwaysLive = import.meta.env.MODE === "all-live";
  const router = useRouter();
  const { controller: toolController, bindWorkspace } = useSpatialController();
  const { toolPanes, addEmpty, getPanes, remove } = toolController;
  const closingToolPanesRef = useRef(new Set<string>());
  const [closingToolPanes, setClosingToolPanes] = useState<ReadonlySet<string>>(() => new Set());
  const isPaneClosing = useCallback(
    (paneId: string) => closingToolPanesRef.current.has(paneId),
    [],
  );
  const [dismissedPaneIds, setDismissedPaneIds] = useState<ReadonlySet<string>>(() => new Set());
  const [draftIds, setDraftIds] = useState<readonly DraftId[]>([]);
  const targetDraftId = target?.kind === "draft" ? target.draftId : null;
  if (targetDraftId !== null && !draftIds.includes(targetDraftId))
    setDraftIds([...draftIds, targetDraftId]);
  const draftKey = useComposerDraftStore((store) =>
    JSON.stringify(
      draftIds.flatMap((draftId) => {
        const draft = store.getDraftThread(draftId);
        return draft
          ? [
              {
                draftId,
                environmentId: draft.environmentId,
                projectId: draft.projectId,
                threadId: draft.promotedTo?.threadId ?? draft.threadId,
                promoted: Boolean(draft.promotedTo),
              },
            ]
          : [];
      }),
    ),
  );
  const threadShells = useThreadShells();
  const drafts = useMemo(() => {
    const shown = new Set(
      threadShells.map((thread) => threadPaneId(thread.environmentId, thread.id)),
    );
    return (JSON.parse(draftKey) as (WorkspaceDraft & { promoted: boolean })[]).flatMap(
      ({ promoted, ...draft }) =>
        dismissedPaneIds.has(draftPaneId(draft.draftId)) ||
        (promoted && shown.has(threadPaneId(draft.environmentId, draft.threadId)))
          ? []
          : [draft],
    );
  }, [dismissedPaneIds, draftKey, threadShells]);
  const panes = useWorkspacePanes(layoutMode, toolPanes, dismissedPaneIds, drafts);
  const [initialPanes, setInitialPanes] = useState(panes);
  if (initialPanes === null && panes !== null) setInitialPanes(panes);
  const [preferences, updatePreferences] = useWorkspacePreferences();
  const paneDefaults = useMemo(() => ({ height: preferences.rowHeight }), [preferences.rowHeight]);
  const gridAxes = layoutMode === "strip" ? "horizontal" : "spatial";
  const [savedLayout] = useState(() => readPaneLayout(layoutMode));
  const initialLayout = useMemo(() => {
    if (!initialPanes) return null;
    const fresh = createWorkspaceScene({
      id: WORKSPACE_ID,
      panes: initialPanes,
      paneDefaults,
      gridAxes,
    });
    const layout = serializeWorkspaceLayout(fresh.scene, fresh.cursor);
    return savedLayout ? reconcilePaneLayout(layout, savedLayout) : layout;
  }, [gridAxes, initialPanes, paneDefaults, savedLayout]);
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  useEffect(() => {
    if (!active) return;
    return installComposerNavigation({
      enabled: (editor) =>
        editor.closest('[data-onirigiri-workspace-id="onirigiri-t3"]') !== null &&
        !editor.closest("[inert]") &&
        editor.closest<HTMLElement>('[data-onirigiri-slot="pane"]')?.dataset.onirigiriPaneId ===
          workspaceRef.current?.getSnapshot().focusedPaneId &&
        !document.querySelector("dialog[open], [role='dialog'][aria-modal='true']"),
      navigate: (direction) => workspaceRef.current?.focus(direction),
    });
  }, [active]);
  const changePreferences = useCallback(
    (change: Partial<WorkspacePreferences>) => {
      const workspace = workspaceRef.current;
      if (change.rowHeight !== undefined && workspace) {
        const layout = workspace.getLayout();
        if (
          layout.columns.some((column) => column.cells.some((cell) => cell.heightPx !== undefined))
        ) {
          workspace.restoreLayout(
            {
              ...layout,
              columns: layout.columns.map((column) => ({
                ...column,
                cells: column.cells.map(({ heightPx: _heightPx, ...cell }) => cell),
              })),
            },
            { keepPresentation: true },
          );
        }
      }
      updatePreferences(change);
    },
    [updatePreferences],
  );
  const [focusAnchor, toggleFocusAnchor] = useFocusAnchorPreference();
  const overviewCardWidth = overviewZoomChoices.find(
    (choice) => choice.value === preferences.overviewZoom,
  )?.width;
  const [workspacePadding, setWorkspacePadding] = useState(0);
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  const [overview, setOverview] = useState(false);
  const onPresentationModeChange = useCallback(
    (mode: string) => setOverview(mode === "overview"),
    [],
  );
  const syncMaximized = useCallback(() => {
    setMaximizedPaneId(workspaceRef.current?.getSnapshot().maximizedPaneId ?? null);
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
  const pictureMount = useCallback(
    (paneId: string) => (lifecycle ? lifecycle.pictureMount(paneId) : "ordinary"),
    [lifecycle],
  );
  const cameraMoving = useSyncExternalStore(
    lifecycle?.subscribeMotion ?? (() => () => {}),
    lifecycle?.isCameraMoving ?? (() => false),
  );
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    if (interacted) return;
    const done = () => setInteracted(true);
    const types = ["pointerdown", "keydown", "wheel"] as const;
    for (const type of types)
      window.addEventListener(type, done, { capture: true, passive: true });
    return () => {
      for (const type of types) window.removeEventListener(type, done, { capture: true });
    };
  }, [interacted]);
  const [hasMoved, setHasMoved] = useState(false);
  if (cameraMoving && interacted && !hasMoved) setHasMoved(true);
  const motionDecision = useCallback(
    (id: string) => lifecycle?.motionDecision(id),
    [lifecycle, cameraMoving],
  );
  const {
    getPanePresentation,
    onLayoutChange: onPictureLayoutChange,
    displayedPictureFor,
    preparedPictureUrl,
    pictureUrl,
    hasFreshPicture,
    canBackgroundPicture,
    picturesLoaded,
    paneSnapshots,
    setCaptureActivity,
    stageRef,
    stageViewport,
  } = useSavedPanePictures(
    getLayout,
    onSnapshotFailure,
    preferences.rowHeight,
    pictureMount,
    !alwaysLive,
    motionDecision,
  );
  const {
    requested: fullScreenRequested,
    fullScreen,
    phase: fullScreenPhase,
  } = useFullScreenTransition(preferences.maximizeAll, stageViewport.width > COMPACT_STAGE_WIDTH);
  const fullScreenBorderRef = useFullScreenBorder(fullScreenPhase, fullScreen, fullScreenRequested);
  const paneViewport = useMemo(() => {
    if (stageViewport.height <= 0) return null;
    return {
      width: Math.max(0, stageViewport.width - workspacePadding * 2),
      height: Math.max(0, stageViewport.height - workspacePadding * 2),
    };
  }, [stageViewport, workspacePadding]);
  const lastLayoutRevisionRef = useRef<number | null>(null);
  const layoutPersistence = useMemo(() => createPaneLayoutPersistence(layoutMode), [layoutMode]);
  useEffect(() => {
    window.addEventListener("pagehide", layoutPersistence.flush);
    return () => {
      window.removeEventListener("pagehide", layoutPersistence.flush);
      layoutPersistence.flush();
    };
  }, [layoutPersistence]);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [focusedRowHeight, setFocusedRowHeight] = useState<number | null>(null);
  const syncFocusedRowHeight = useCallback(() => {
    const workspace = workspaceRef.current;
    const focusedId = workspace?.getSnapshot().focusedPaneId;
    const cell = workspace
      ?.getLayout()
      .columns.flatMap((column) => column.cells)
      .find((candidate) => candidate.paneId === focusedId);
    setFocusedRowHeight(cell?.heightPx ?? null);
  }, []);
  const onLayoutChange = useCallback<NonNullable<OnirigiriWorkspaceProps["onLayoutChange"]>>(
    (layout, metadata) => {
      layoutPersistence.save(layout);
      if (lastLayoutRevisionRef.current === metadata.layoutRevision) return;
      lastLayoutRevisionRef.current = metadata.layoutRevision;
      setLayoutRevision(metadata.layoutRevision);
      syncFocusedRowHeight();
      setWorkspacePadding(workspaceRef.current?.getScene().padding ?? 0);
      syncMaximized();
      onPictureLayoutChange(layout);
      lifecycle?.setPanes(threadLayoutPositions(layout));
    },
    [layoutPersistence, lifecycle, onPictureLayoutChange, syncFocusedRowHeight, syncMaximized],
  );

  const focusedPaneIdRef = useRef<string | null>(null);
  const pendingFocusPaneIdRef = useRef<string | null>(null);

  const paneData = useMemo(() => {
    const byPaneId = new Map<string, ThreadPaneData>();
    for (const pane of panes ?? []) {
      if (pane.surfaceKind === "draft") continue;
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
          '[data-onirigiri-slot="pane"][data-visible="false"], [data-onirigiri-slot="pane-content"][data-runtime-state="hidden"], [data-spatial-full-screen-transition]',
        ),
      occluders: spatialBrowserOccluders,
      interactive: (slot) =>
        !slot.closest('[data-onirigiri-shielded="true"], [data-runtime-state="frozen"]'),
      focus: (slot) => {
        slot.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
        );
      },
      keyboard: {
        shortcuts: BROWSER_SHORTCUTS,
        keyDown: (slot, event) => {
          const pane = slot.closest<HTMLElement>("[data-onirigiri-pane-id]");
          if (
            !activeRef.current ||
            !pane ||
            pane.closest("[inert]") ||
            pane.dataset.onirigiriPaneId !== workspaceRef.current?.getSnapshot().focusedPaneId ||
            document.querySelector("dialog[open], [role='dialog'][aria-modal='true']")
          )
            return;
          pane.focus({ preventScroll: true });
          slot.dispatchEvent(event);
        },
      },
    }),
    [],
  );

  const routePaneId =
    target?.kind === "server"
      ? threadPaneId(target.threadRef.environmentId, target.threadRef.threadId)
      : target?.kind === "draft"
        ? draftPaneId(target.draftId)
        : null;

  if (!alwaysLive && lifecycle === null && initialLayout !== null) {
    setLifecycle(createPaneLifecycleStore(threadLayoutPositions(initialLayout), routePaneId));
  }

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!panes || !workspace) return;
    const previous = panesRef.current;
    panesRef.current = panes;
    if (!previous || previous === panes) return;
    const previousById = new Map(previous.map((pane) => [pane.paneId, pane]));
    if (panes.length !== previous.length || panes.some((pane) => !previousById.has(pane.paneId))) {
      const { scene } = createWorkspaceScene({
        gridAxes,
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
      const current = workspace.getLayout();
      for (const pane of panes) {
        if (pane.surfaceKind !== "thread" || previousById.has(pane.paneId)) continue;
        const draft = previous.find(
          (candidate) =>
            candidate.surfaceKind === "draft" &&
            !panes.some((next) => next.paneId === candidate.paneId) &&
            threadPaneId(
              (candidate.data as WorkspaceDraft).environmentId,
              (candidate.data as WorkspaceDraft).threadId,
            ) === pane.paneId,
        );
        const column =
          draft &&
          current.columns.find((candidate) =>
            candidate.cells.some((cell) => cell.paneId === draft.paneId),
          );
        if (column)
          pendingPlacementRef.current.set(pane.paneId, {
            plane: column.planeIndex,
            slot: column.slotIndex ?? column.index,
            newPlane: false,
            heightPx: column.cells.length === 1 ? (column.cells[0]!.heightPx ?? null) : null,
          });
      }
      let next = reconcilePaneLayout(layout, current, focused?.paneId);
      for (const [paneId, placement] of pendingPlacementRef.current) {
        if (!panes.some((pane) => pane.paneId === paneId)) continue;
        pendingPlacementRef.current.delete(paneId);
        next = placePane(next, paneId, placement, {
          focusPaneId: focused?.paneId ?? null,
          inserted: !previousById.has(paneId),
        });
      }
      workspace.restoreLayout(next, { keepPresentation: true });
      if (added && workspace.getSnapshot().presentationMode === "overview") {
        workspace.focusPane(added, { exitOverview: true });
      }
      return;
    }
    for (const pane of panes) {
      const before = previousById.get(pane.paneId);
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
  }, [gridAxes, paneDefaults, panes]);

  useEffect(() => () => lifecycle?.dispose(), [lifecycle]);
  useEffect(() => {
    lifecycle?.setFocus(overview ? null : focusedPaneIdRef.current);
  }, [lifecycle, overview]);
  useEffect(() => {
    lifecycle?.setPictures(
      hasFreshPicture,
      picturesLoaded,
      canBackgroundPicture,
      (id) => displayedPictureFor(id) !== null,
    );
  }, [hasFreshPicture, lifecycle, picturesLoaded, canBackgroundPicture, displayedPictureFor]);
  useEffect(() => lifecycle?.setKeepNeighbours(fullScreen), [fullScreen, lifecycle]);
  const fullScreenPhaseRef = useRef(fullScreenPhase);
  useEffect(() => {
    fullScreenPhaseRef.current = fullScreenPhase;
    const pictures = !alwaysLive && active && fullScreenPhase === null;
    lifecycle?.setBackgroundPictures(pictures);
    setCaptureActivity(pictures, lifecycle?.isMoving() ?? false);
  }, [active, alwaysLive, fullScreenPhase, lifecycle, setCaptureActivity]);

  const requestedRoutesRef = useRef(new Set<string>());
  const pendingNavigationPaneRef = useRef<string | null>(null);
  const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRouteRef = useRef<(() => void) | null>(null);
  const routePaneIdRef = useRef(routePaneId);
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
  useEffect(() => {
    if (!active) useWorkspaceFocusedThreadStore.getState().setFocusedThreadKey(null);
    return () => useWorkspaceFocusedThreadStore.getState().setFocusedThreadKey(null);
  }, [active]);

  const onFocusedPaneFrame = useCallback(
    (frame: WorkspaceFocusedPaneFrame | null, moving: boolean) => {
      syncMaximized();
      setCaptureActivity(
        !alwaysLive && activeRef.current && fullScreenPhaseRef.current === null,
        moving,
      );
      lifecycle?.setMoving(activeRef.current && moving);
      if (workspaceRef.current?.getSnapshot().presentationMode === "overview") {
        lifecycle?.setFocus(null);
        return;
      }
      const paneId = frame?.paneId ?? workspaceRef.current?.getSnapshot().focusedPaneId ?? null;
      if (paneId === focusedPaneIdRef.current || !activeRef.current) return;
      focusedPaneIdRef.current = paneId;
      syncFocusedRowHeight();
      if (paneId === null) {
        lifecycle?.setFocus(null);
        useWorkspaceFocusedThreadStore.getState().setFocusedThreadKey(null);
        return;
      }
      const tool = getPanes().find((pane) => pane.paneId === paneId);
      const routeTarget = tool ? threadPaneId(tool.environmentId, tool.threadId) : paneId;
      if (pendingNavigationPaneRef.current !== routeTarget) pendingNavigationPaneRef.current = null;
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
      routeTimerRef.current = null;
      pendingRouteRef.current = null;
      if (paneId.startsWith("draft:")) {
        lifecycle?.setFocus(null);
        useWorkspaceFocusedThreadStore.getState().setFocusedThreadKey(null);
        if (paneId === routePaneIdRef.current) return;
        const draftId = paneId.slice("draft:".length);
        const followDraft = () => {
          routeTimerRef.current = null;
          pendingRouteRef.current = null;
          if (focusedPaneIdRef.current !== paneId) return;
          requestedRoutesRef.current.add(paneId);
          void router.navigate({ to: "/draft/$draftId", params: { draftId } });
        };
        pendingRouteRef.current = followDraft;
        routeTimerRef.current = setTimeout(followDraft, ROUTE_SETTLE_MS);
        return;
      }
      const data = paneData.get(routeTarget);
      if (!data) return;
      useWorkspaceFocusedThreadStore
        .getState()
        .setFocusedThreadKey(scopedThreadKey(scopeThreadRef(data.environmentId, data.threadId)));
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
    [
      alwaysLive,
      getPanes,
      syncFocusedRowHeight,
      syncMaximized,
      lifecycle,
      paneData,
      router,
      setCaptureActivity,
    ],
  );

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

  useEffect(() => {
    if (!lifecycle) return;
    if (!active) {
      lifecycle.setMoving(false);
      return;
    }
    const paneId = workspaceRef.current?.getSnapshot().focusedPaneId;
    if (paneId && paneId !== focusedPaneIdRef.current && paneData.has(paneId)) {
      focusedPaneIdRef.current = paneId;
      lifecycle.setFocus(overview ? null : paneId);
    }
  }, [active, lifecycle, paneData, overview]);

  const pendingRoutePaneRef = useRef<string | null>(null);
  const focusRoutePane = useEffectEvent((paneId: string) => {
    if (requestedRoutesRef.current.delete(paneId)) return;
    setDismissedPaneIds((current) => withoutPane(current, paneId));
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

  const addPaneBeside = useCallback(
    (paneId: string | null) => {
      if (!paneId) return;
      const tool = getPanes().find((pane) => pane.paneId === paneId);
      const pane = workspaceRef.current?.getScene().paneById.get(paneId);
      const owner =
        tool ?? (pane?.surfaceKind === "thread" ? (pane.data as ThreadPaneData) : undefined);
      if (!owner) return;
      pendingFocusPaneIdRef.current = addEmpty(
        { environmentId: owner.environmentId, threadId: owner.threadId },
        tool?.paneId ?? null,
      );
    },
    [addEmpty, getPanes],
  );
  const addPane = useCallback(() => addPaneBeside(focusedPaneIdRef.current), [addPaneBeside]);
  const pendingPlacementRef = useRef(new Map<string, PanePlacement>());
  const newThread = useNewThreadHandler();
  const startChatInPane = useCallback(
    async (tool: ToolPane) => {
      const shell = readThreadShell(scopeThreadRef(tool.environmentId, tool.threadId));
      if (!shell) return;
      const column = workspaceRef.current
        ?.getLayout()
        .columns.find((candidate) => candidate.cells.some((cell) => cell.paneId === tool.paneId));
      const draft = await newThread(scopeProjectRef(tool.environmentId, shell.projectId));
      if (!draft) return;
      if (column)
        pendingPlacementRef.current.set(draftPaneId(draft.draftId), {
          plane: column.planeIndex,
          slot: column.slotIndex ?? column.index,
          newPlane: false,
          heightPx: column.cells.length === 1 ? (column.cells[0]!.heightPx ?? null) : null,
        });
      remove(tool.paneId);
    },
    [newThread, remove],
  );
  const addPaneAt = useCallback(
    (spot: EmptySpot) => {
      const scene = workspaceRef.current?.getScene();
      const ownerOf = (paneId: string | null | undefined) => {
        if (!paneId) return undefined;
        const tool = getPanes().find((pane) => pane.paneId === paneId);
        if (tool) return { owner: tool as ThreadPaneData, after: tool.paneId };
        const pane = scene?.paneById.get(paneId);
        return pane?.surfaceKind === "thread"
          ? { owner: pane.data as ThreadPaneData, after: null }
          : undefined;
      };
      const resolved =
        ownerOf(spot.ownerPaneId) ??
        ownerOf(focusedPaneIdRef.current) ??
        ownerOf(panesRef.current?.find((pane) => pane.surfaceKind === "thread")?.paneId);
      if (!resolved) return;
      const paneId = addEmpty(
        { environmentId: resolved.owner.environmentId, threadId: resolved.owner.threadId },
        resolved.after,
      );
      pendingPlacementRef.current.set(paneId, spot.placement);
    },
    [addEmpty, getPanes],
  );

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
        if (pane.surfaceKind !== "thread" && pane.surfaceKind !== "draft") return false;
        setDismissedPaneIds((current) => new Set([...current, pane.paneId]));
        if (pane.surfaceKind === "draft" && routePaneIdRef.current === pane.paneId)
          setTimeout(() => {
            const focused = workspaceRef.current?.getSnapshot().focusedPaneId;
            const owner =
              toolController.getPanes().find((candidate) => candidate.paneId === focused) ??
              (panesRef.current?.find(
                (candidate) => candidate.paneId === focused && candidate.surfaceKind === "thread",
              )?.data as ThreadPaneData | undefined);
            if (!owner) {
              void router.navigate({ to: "/" });
              return;
            }
            requestedRoutesRef.current.add(threadPaneId(owner.environmentId, owner.threadId));
            void router.navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId: owner.environmentId, threadId: owner.threadId },
            });
          });
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
              return closeTerminalSurface(current, terminalId) ?? current;
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
        pendingFocusPaneIdRef.current = threadPaneId(tool.environmentId, tool.threadId);
        remove(tool.paneId);
        return false;
      } finally {
        closingToolPanesRef.current.delete(tool.paneId);
        setClosingToolPanes(new Set(closingToolPanesRef.current));
      }
    },
    [closePreview, closeTerminal, isPaneClosing, remove, router, toolController],
  );

  const navigateFromTerminal = useCallback<OnirigiriWorkspaceHandle["focus"]>(
    (direction) => workspaceRef.current?.focus(direction) ?? false,
    [],
  );

  const closeChatPane = useCallback((paneId: string) => {
    void workspaceRef.current?.closePane(paneId);
  }, []);
  const togglePaneMaximized = useCallback(
    (paneId: string) => {
      workspaceRef.current?.togglePaneMaximized(paneId);
      syncMaximized();
    },
    [syncMaximized],
  );
  const focusSurfacePane = useCallback((paneId: string) => {
    if (workspaceRef.current?.focusPane(paneId, { exitOverview: true })) return;
    pendingFocusPaneIdRef.current = paneId;
    setDismissedPaneIds((current) => withoutPane(current, paneId));
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
      if (pane.surfaceKind === "draft") {
        return (
          <SpatialSurfaceHost
            controller={toolController}
            paneId={pane.paneId}
            focusPane={focusSurfacePane}
            isPaneClosing={isPaneClosing}
          >
            <DraftPane
              draftId={(pane.data as WorkspaceDraft).draftId}
              paneId={pane.paneId}
              focused={state.focused}
              maximized={state.maximized}
              onNavigateAway={navigateAway}
              onAddPane={addPaneBeside}
              onClosePane={closeChatPane}
              onToggleMaximized={togglePaneMaximized}
            />
          </SpatialSurfaceHost>
        );
      }
      const tool =
        pane.surfaceKind === "thread"
          ? null
          : (toolPanes.find((candidate) => candidate.paneId === pane.paneId) ??
            (pane.data as ToolPane));
      return (
        <SpatialSurfaceHost
          controller={toolController}
          paneId={pane.paneId}
          focusPane={focusSurfacePane}
          isPaneClosing={isPaneClosing}
        >
          {tool ? (
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
                onDismissDeviceSetup={(surface) => {
                  toolController.recordUserAction(tool);
                  toolController.clearSurface(tool.paneId, surface.id);
                }}
                onFocusThread={() =>
                  focusSurfacePane(threadPaneId(tool.environmentId, tool.threadId))
                }
                onStartChat={() => void startChatInPane(tool)}
              />
            </div>
          ) : (
            <ThreadPane
              thread={pane.data as ThreadPaneData}
              focused={state.focused}
              visible={state.visible}
              settledVisible={state.settledVisible}
              paneId={pane.paneId}
              onNavigateAway={navigateAway}
              maximized={state.maximized}
              onAddPane={addPaneBeside}
              onClosePane={closeChatPane}
              onToggleMaximized={togglePaneMaximized}
            />
          )}
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
      startChatInPane,
      toolController,
      toolPanes,
    ],
  );

  const renderPanePlaceholder = useCallback(
    (pane: WorkspacePane) => {
      if (pane.surfaceKind !== "thread") return null;
      const data = pane.data as ThreadPaneData;
      const card = hasMoved ? (
        <ThreadCard environmentId={data.environmentId} threadId={data.threadId} />
      ) : (
        <div className="h-full w-full bg-background" />
      );
      const picture = displayedPictureFor(pane.paneId);
      return picture ? (
        <SavedPanePicture
          key={picture.geometryRevision.endsWith("|compact") ? "compact" : "tiled"}
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
    [displayedPictureFor, hasMoved, pictureUrl, preparedPictureUrl],
  );

  const [stageElement, setStageElement] = useState<HTMLElement | null>(null);
  const attachStage = useCallback(
    (element: HTMLDivElement | null) => {
      stageRef(element);
      setStageElement(element);
    },
    [stageRef],
  );
  const getFocusedPaneId = useCallback(() => focusedPaneIdRef.current, []);
  const emptySpots = useEmptySpots(
    stageElement,
    active &&
      maximizedPaneId === null &&
      initialPanes !== null &&
      (alwaysLive || lifecycle !== null),
    cameraMoving,
    layoutMode !== "strip",
    getLayout,
    getFocusedPaneId,
    typeof preferences.rowHeight === "number"
      ? Math.min(preferences.rowHeight, paneViewport?.height ?? preferences.rowHeight)
      : (paneViewport?.height ?? null),
    `${layoutRevision}|${panes?.length ?? 0}|${overview}`,
  );


  return (
    <WorkspaceTooltips>
      <LinkPullRequestDialogHost />
      <div
        ref={attachStage}
        inert={!active}
        className="spatial-workspace relative flex h-full w-full flex-col"
        data-spatial-navigation-bar={String(preferences.navigationBar)}
        data-spatial-maximized={String(maximizedPaneId !== null)}
        data-spatial-full-screen-transition={fullScreenPhase ?? undefined}
      >
        <WorkspaceToolbar
          focusAnchor={focusAnchor}
          onAdd={addPane}
          onToggleAnchor={toggleFocusAnchor}
          preferences={preferences}
          focusedRowHeight={focusedRowHeight}
          maxRowHeight={
            stageViewport.compact ? stageViewport.height : (paneViewport?.height ?? null)
          }
          onPreferencesChange={changePreferences}
          layoutMode={layoutMode}
          onLayoutModeChange={onLayoutModeChange}
          controlsRef={setControlsContainer}
          shortcuts={SHORTCUTS}
        />
        {initialPanes && (alwaysLive || lifecycle) ? (
          <SpatialWorkspaceActiveContext value={active}>
            <PaneLifecycleContext value={lifecycle}>
              <PaneSnapshotContext value={alwaysLive ? null : paneSnapshots}>
                <BrowserSurfaceProjectionContext value={browserProjection}>
                  <OnirigiriWorkspace
                    ref={workspaceRef}
                    ariaLabel="Onirigiri for T3 Code"
                    className="min-h-0 flex-1"
                    compactBreakpoint={fullScreen ? Number.POSITIVE_INFINITY : COMPACT_STAGE_WIDTH}
                    {...(fullScreenPhase === "swap" || fullScreenPhase === "enter"
                      ? { cameraMotion: SNAP_CAMERA }
                      : {})}
                    chromeComponents={WORKSPACE_CHROME}
                    desktopControlsContainer={preferences.navigationBar ? null : controlsContainer}
                    focusAnchor={focusAnchor}
                    {...(stageViewport.compact && !overview ? { focusHighlight: false } : {})}
                    getPanePresentation={getPanePresentation}
                    gridAxes={gridAxes}
                    initialPanes={initialPanes}
                    initialLayout={initialLayout}
                    liveContent
                    onFocusedPaneFrame={onFocusedPaneFrame}
                    onLayoutChange={onLayoutChange}
                    onPresentationModeChange={onPresentationModeChange}
                    onPaneClose={onPaneClose}
                    {...(overviewCardWidth === undefined
                      ? {}
                      : {
                          overviewCardMaxWidthPx: overviewCardWidth,
                          overviewCardMinWidthPx: overviewCardWidth,
                        })}
                    paneDefaults={paneDefaults}
                    renderPane={renderPane}
                    renderPanePlaceholder={renderPanePlaceholder}
                    restPictureFade={!alwaysLive}
                    focusPaneOnPointer={preferences.focusOnClick}
                    shortcutScope={active ? "application" : "workspace"}
                    shortcuts={SHORTCUTS}
                    workspaceId={WORKSPACE_ID}
                  />
                </BrowserSurfaceProjectionContext>
              </PaneSnapshotContext>
            </PaneLifecycleContext>
          </SpatialWorkspaceActiveContext>
        ) : null}
        <EmptySpotGrid
          cells={emptySpots.cells}
          container={emptySpots.container}
          showGrid={preferences.showGrid}
          onAdd={addPaneAt}
        />
        <FullScreenBorder ref={fullScreenBorderRef} />
      </div>
    </WorkspaceTooltips>
  );
}
