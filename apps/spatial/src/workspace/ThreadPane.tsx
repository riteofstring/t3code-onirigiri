import { COMPOSER_NAVIGATION } from "./composerNavigation";
import { flushPaneVisualChanges, observePaneVisualChanges } from "./paneVisualChanges";
import { useOnirigiriPaneContentReady, useOnirigiriPaneInteractive } from "@riteofstring/onirigiri";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  memo,
  startTransition,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ChatViewHostContext } from "@t3tools/web/src/components/chatViewHost";
import { ChatViewActivityContext } from "@t3tools/web/src/components/chatViewActivity";
import { ChatViewContentReadyProvider } from "@t3tools/web/src/components/chatViewContentReady";
import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";
import {
  ComposerHandleContext,
  type ComposerHandleRef,
  useComposerHandleContext,
} from "@t3tools/web/src/composerHandleContext";
import { ChatPaneControlsContext } from "@t3tools/web/src/components/chatPaneControls";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import {
  useThreadHistory,
  useThreadProjection,
  useThreadShell,
  useThreadStatus,
} from "@t3tools/web/src/state/entities";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";
import {
  PanelAnimationSuppressionProvider,
  usePanelNavigationSuppression,
} from "@t3tools/web/src/panelAnimations";

import { usePaneActivity } from "./paneActivity";
import { PaneLifecycleContext, usePaneMounted } from "./paneLifecycle";
import { hasLivePaneProducer } from "./panePictureSnapshot";
import { PICTURE_IDLE_BUDGET_MS } from "./panePictureIdle";
import { PaneSnapshotContext, markPaneSynced, usePanePictureTheme } from "./useSavedPanePictures";

export const SpatialWorkspaceActiveContext = createContext(true);

export interface ThreadPaneThread {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function PaneThreadRoute() {
  const target = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return target ? <ThreadRouteView target={target} /> : null;
}

const paneRootRoute = createRootRoute({ component: Outlet });
const paneRouteTree = paneRootRoute.addChildren([
  createRoute({
    getParentRoute: () => paneRootRoute,
    path: "$environmentId/$threadId",
    component: PaneThreadRoute,
  }),
]);

const PaneRouter = memo(function PaneRouter({
  router,
  threadPath,
}: {
  router: ReturnType<typeof createPaneRouter>;
  threadPath: string;
}) {
  const suppressed = usePanelNavigationSuppression(threadPath);
  return (
    <PanelAnimationSuppressionProvider value={suppressed}>
      <RouterProvider router={router} />
    </PanelAnimationSuppressionProvider>
  );
});

const NEIGHBOUR_MOUNT_DELAY_MS = 300;
const STATUS_WAIT_MS = 1000;
const PICTURE_FADE_MS = 100;

function usePaneContent(
  paneId: string,
  thread: ThreadPaneThread,
  visible: boolean,
  settledVisible: boolean,
  focused: boolean,
  visualRevision: number,
  composerReady: boolean,
): {
  mounted: boolean;
  preparing: boolean;
  picturable: string | null;
  onContentReadyChange: (ready: boolean) => void;
} {
  const lifecycle = use(PaneLifecycleContext);
  const snapshots = use(PaneSnapshotContext);
  const mounted = usePaneMounted(paneId, settledVisible);
  const shell = useThreadShell(thread);
  const [contentMounted, setContentMounted] = useState(false);
  const renderContent = mounted && contentMounted;
  const projection = useThreadProjection(renderContent ? thread : null)?.projection ?? null;
  const history = useThreadHistory(renderContent ? thread : null);
  const updatedAt = shell?.updatedAt ?? null;
  const projectionUpdatedAt = projection ? DateTime.formatIso(projection.updatedAt) : null;
  const status = useThreadStatus(mounted ? thread : null);
  const statusReady = status === "live" || status === "cached" || status === "deleted";
  const [waitedForStatus, setWaitedForStatus] = useState(false);
  useEffect(() => {
    if (!mounted || !visible || statusReady || waitedForStatus) return;
    const timer = setTimeout(() => setWaitedForStatus(true), STATUS_WAIT_MS);
    return () => clearTimeout(timer);
  }, [mounted, statusReady, visible, waitedForStatus]);
  const contentAvailable = focused || statusReady || waitedForStatus;
  useEffect(() => {
    if (!mounted) setContentMounted(false);
    else if (contentAvailable && !contentMounted) {
      const show = () => startTransition(() => setContentMounted(true));
      let idle: number | null = null;
      let dwell: ReturnType<typeof setTimeout> | null = null;
      const prepare = () => {
        if (idle !== null) cancelIdleCallback(idle);
        if (dwell !== null) clearTimeout(dwell);
        idle = dwell = null;
        if (lifecycle?.isMoving()) {
          return;
        } else if (focused || visible) {
          if (focused || !snapshots?.hasFreshPicture(paneId)) show();
          else dwell = setTimeout(show, NEIGHBOUR_MOUNT_DELAY_MS);
        }
        else
          idle = requestIdleCallback((deadline) => {
            idle = null;
            if (deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS) prepare();
            else show();
          });
      };
      const unsubscribe = lifecycle?.subscribeMotion(prepare);
      prepare();
      return () => {
        unsubscribe?.();
        if (idle !== null) cancelIdleCallback(idle);
        if (dwell !== null) clearTimeout(dwell);
      };
    }
  }, [
    contentAvailable,
    contentMounted,
    focused,
    lifecycle,
    mounted,
    paneId,
    settledVisible,
    snapshots,
    visible,
  ]);
  useEffect(() => {
    if (contentMounted) lifecycle?.contentMounted(paneId);
  }, [contentMounted, lifecycle, paneId]);
  const synced = status === "live" || status === "deleted";
  const pictureTheme = usePanePictureTheme();
  const running = threadRuntimeIsActive(shell?.runtime);
  const [contentRevision, setContentRevision] = useState({ updatedAt, projectionUpdatedAt });
  const nextProjectionUpdatedAt = renderContent
    ? projectionUpdatedAt
    : contentRevision.projectionUpdatedAt;
  if (
    !running &&
    (contentRevision.updatedAt !== updatedAt ||
      contentRevision.projectionUpdatedAt !== nextProjectionUpdatedAt)
  )
    setContentRevision({ updatedAt, projectionUpdatedAt: nextProjectionUpdatedAt });
  const revision = `${contentRevision.updatedAt}|${contentRevision.projectionUpdatedAt}|${pictureTheme}`;
  const [settled, setSettled] = useState(false);
  const [viewReady, setViewReady] = useState(false);
  const contentReady = status === "deleted" || (viewReady && !history.loading);
  const prepared = renderContent && synced && contentReady && settled;
  const [presented, setPresented] = useState(false);
  if (presented && !renderContent) setPresented(false);
  else if (!presented && prepared) setPresented(true);

  useLayoutEffect(() => {
    markPaneSynced(
      paneId,
      prepared && projectionUpdatedAt !== null
        ? { updatedAt: projectionUpdatedAt, theme: pictureTheme }
        : null,
      visualRevision,
    );
    return () => markPaneSynced(paneId, null);
  }, [projectionUpdatedAt, paneId, pictureTheme, prepared, visualRevision]);

  const [composerShown, setComposerShown] = useState(false);
  if (composerShown && !renderContent) setComposerShown(false);
  else if (!composerShown && renderContent && composerReady) setComposerShown(true);

  useOnirigiriPaneContentReady(
    renderContent && (composerShown || presented),
    `${revision}|${presented && !prepared}|${visualRevision}`,
  );

  useEffect(() => {
    if (!renderContent || !synced || !contentReady) return;
    const idle = requestIdleCallback(() => setSettled(true));
    return () => {
      cancelIdleCallback(idle);
      setSettled(false);
    };
  }, [contentReady, renderContent, synced]);

  return {
    mounted: renderContent,
    preparing: renderContent && !presented,
    onContentReadyChange: setViewReady,
    picturable:
      prepared &&
      !running &&
      projectionUpdatedAt !== null &&
      updatedAt !== null &&
      projectionUpdatedAt >= updatedAt
        ? revision
        : null,
  };
}

function createPaneRouter(threadPath: string) {
  return createRouter({
    routeTree: paneRouteTree,
    history: createMemoryHistory({ initialEntries: [threadPath] }),
  });
}

export const ThreadPane = memo(function ThreadPane(props: React.ComponentProps<typeof PaneBody>) {
  const thread = useMemo(
    () => ({ environmentId: props.thread.environmentId, threadId: props.thread.threadId }),
    [props.thread.environmentId, props.thread.threadId],
  );
  const body = <PaneBody {...props} thread={thread} />;
  return body;
});

const PaneBody = memo(function PaneBody({
  thread,
  paneId,
  focused,
  visible,
  settledVisible,
  onNavigateAway,
  maximized = false,
  onAddPane,
  onClosePane,
  onToggleMaximized,
}: {
  thread: ThreadPaneThread;
  paneId: string;
  focused: boolean;
  visible: boolean;
  settledVisible: boolean;
  onNavigateAway: (href: string) => void;
  maximized?: boolean;
  onAddPane?: (paneId: string) => void;
  onClosePane?: (paneId: string) => void;
  onToggleMaximized?: (paneId: string) => void;
}) {
  const paneControls = useMemo(
    () =>
      onAddPane && onClosePane && onToggleMaximized
        ? {
            maximized,
            addPane: () => onAddPane(paneId),
            closePane: () => onClosePane(paneId),
            toggleMaximized: () => onToggleMaximized(paneId),
          }
        : null,
    [maximized, onAddPane, onClosePane, onToggleMaximized, paneId],
  );
  const lifecycle = use(PaneLifecycleContext);
  const presentedCameraMoving = useSyncExternalStore(
    lifecycle?.subscribeMotion ?? (() => () => {}),
    lifecycle?.isCameraMoving ?? (() => false),
  );
  const interactive = useOnirigiriPaneInteractive();
  const workspaceActive = use(SpatialWorkspaceActiveContext);
  const liveVisible = workspaceActive && interactive;
  const active = focused && liveVisible && !presentedCameraMoving;
  const threadPath = `/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.threadId)}`;
  const [router] = useState(() => createPaneRouter(threadPath));
  const [visualRevision, setVisualRevision] = useState(0);
  const [composerReady, setComposerReady] = useState(false);
  const deferred = useSyncExternalStore(
    useCallback(
      (notify) => lifecycle?.subscribe(paneId, notify) ?? (() => {}),
      [lifecycle, paneId],
    ),
    () => lifecycle?.timelineDeferred(paneId) ?? false,
  );
  const { mounted, preparing, picturable, onContentReadyChange } = usePaneContent(
    paneId,
    thread,
    visible,
    settledVisible,
    focused,
    visualRevision,
    composerReady,
  );

  const paneComposerRef = usePaneComposerHandle(active);

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<{ top: number; atEnd: boolean }[]>([]);
  const saveScroll = useRef<(() => void) | null>(null);
  const localStateAtRisk = useRef(false);
  const shell = useThreadShell(thread);
  const snapshots = use(PaneSnapshotContext);
  const maximizedRef = useRef(maximized);
  maximizedRef.current = maximized;
  const motionState = useRef<() => string | null>(() => "not-ready");
  motionState.current = () => {
    if (threadRuntimeIsActive(shell?.runtime)) return "in-progress-turn";
    if (shell?.hasPendingApprovals || shell?.pendingSubagentRequest === "approval")
      return "pending-approval";
    if (shell?.hasPendingUserInput || shell?.pendingSubagentRequest === "user_input")
      return "pending-question";
    flushPaneVisualChanges(paneId);
    if (localStateAtRisk.current) return "local-ui-interaction";
    if (maximizedRef.current) return "full-screen";
    if (!snapshots?.hasFreshPicture(paneId))
      return mounted ? `no-current-picture:${snapshots?.pictureMiss(paneId)}` : "not-ready";
    if (!snapshots.timelinePicture(paneId)) return "picture-not-decoded";
    if (!preparing) saveScroll.current?.();
    const element = contentRef.current;
    if (element?.contains(document.activeElement))
      element.closest<HTMLElement>('[data-onirigiri-slot="pane"]')?.focus({ preventScroll: true });
    return null;
  };
  useLayoutEffect(
    () => lifecycle?.registerChat?.(paneId, () => motionState.current()),
    [lifecycle, paneId],
  );
  useLayoutEffect(() => {
    if (!mounted || (!composerReady && preparing)) return;
    lifecycle?.composerReady?.(paneId);
    if (!interactive) return;
    const editor = contentRef.current?.querySelector<HTMLElement>(
      '[data-testid="composer-editor"]',
    );
    if (editor && (!editor.isContentEditable || editor.closest("[inert]"))) return;
    if (editor) lifecycle?.recordReady?.(paneId, "composerTypeableAt");
    if (!preparing) lifecycle?.recordReady?.(paneId, "timelineInteractiveAt");
  }, [composerReady, interactive, lifecycle, mounted, paneId, preparing]);
  const [pictureLeaving, setPictureLeaving] = useState(false);
  const wasPreparing = useRef(preparing);
  useLayoutEffect(() => {
    const finished = wasPreparing.current && !preparing;
    wasPreparing.current = preparing;
    if (!finished) return;
    setPictureLeaving(true);
    const timer = setTimeout(() => setPictureLeaving(false), PICTURE_FADE_MS);
    return () => clearTimeout(timer);
  }, [preparing]);
  const host = useMemo(
    () => ({
      deferTimeline: deferred,
      timelineFallback:
        preparing || pictureLeaving ? (
          <TimelinePicture paneId={paneId} leaving={!preparing} />
        ) : null,
      onComposerReady: setComposerReady,
    }),
    [deferred, paneId, pictureLeaving, preparing],
  );
  const activity = usePaneActivity(active, liveVisible, contentRef);

  const focusOnArrival = useRef(false);
  const arrivalText = useRef("");
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const editing =
        event.target instanceof Element &&
        event.target.closest('[contenteditable="true"], input, textarea, select');
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.startsWith("Arrow") &&
        !editing
      )
        focusOnArrival.current = true;
      else if (event.key === "Tab" || event.key === "Escape") focusOnArrival.current = false;
    };
    const cancel = () => {
      focusOnArrival.current = false;
    };
    const composerNavigation = () => {
      focusOnArrival.current = true;
    };
    window.addEventListener(COMPOSER_NAVIGATION, composerNavigation);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", cancel, true);
    return () => {
      window.removeEventListener(COMPOSER_NAVIGATION, composerNavigation);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", cancel, true);
    };
  }, []);
  useEffect(() => {
    if (!lifecycle || !focused || !workspaceActive) return;
    const capture = (event: KeyboardEvent) => {
      if (
        lifecycle.isCameraMoving() ||
        (!focusOnArrival.current && mounted && composerReady && interactive) ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, select, [contenteditable="true"]') &&
          !event.target.closest("[inert]"))
      )
        return;
      if ([...event.key].length === 1) arrivalText.current += event.key;
      else if (event.key === "Enter" && arrivalText.current) arrivalText.current += "\n";
      else if (event.key === "Backspace" && arrivalText.current)
        arrivalText.current = [...arrivalText.current].slice(0, -1).join("");
      else return;
      focusOnArrival.current = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      localStateAtRisk.current = true;
      if (
        active &&
        composerReady &&
        paneComposerRef.current?.insertTextAtEnd(arrivalText.current)
      ) {
        arrivalText.current = "";
        focusOnArrival.current = false;
      }
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [
    active,
    composerReady,
    focused,
    interactive,
    lifecycle,
    mounted,
    paneComposerRef,
    workspaceActive,
  ]);
  useLayoutEffect(() => {
    if (
      active &&
      mounted &&
      (composerReady || !lifecycle) &&
      (focusOnArrival.current || arrivalText.current) &&
      paneComposerRef.current
    ) {
      if (arrivalText.current) {
        if (!paneComposerRef.current.insertTextAtEnd(arrivalText.current)) return;
        arrivalText.current = "";
      }
      focusOnArrival.current = false;
      paneComposerRef.current.focusAtEnd();
    }
  }, [active, composerReady, lifecycle, mounted, paneComposerRef]);

  const snapshotPrepared = useRef(false);
  const producerInspected = useRef(false);
  const scrollOffsets = useRef(new WeakMap<HTMLElement, string>());
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element || !snapshots) return;
    if (!mounted) {
      snapshotPrepared.current = false;
      producerInspected.current = false;
      return;
    }
    const inspectProducer = () => {
      if (snapshots)
        setVisualRevision(snapshots.setLiveProducer(paneId, hasLivePaneProducer(element)));
    };
    if (!producerInspected.current) {
      inspectProducer();
      producerInspected.current = true;
    }
    const producerChanged = (record: MutationRecord) =>
      record.attributeName === "data-browser-surface-slot" ||
      [...record.addedNodes, ...record.removedNodes].some(
        (node) => node instanceof Element && hasLivePaneProducer(node),
      );
    if (picturable !== null && !snapshotPrepared.current) {
      for (const scroller of element.querySelectorAll<HTMLElement>(
        '.messages-timeline-scroll, [data-tool-group-scroll], [data-testid="composer-editor"]',
      ))
        scrollOffsets.current.set(scroller, `${scroller.scrollLeft}|${scroller.scrollTop}`);
      snapshotPrepared.current = true;
    }
    const invalidate = (event?: Event) => {
      if (lifecycle && !lifecycle.isMounted(paneId)) return;
      if (event?.type === "scroll" && event.target instanceof HTMLElement) {
        const target = event.target;
        const next = `${target.scrollLeft}|${target.scrollTop}`;
        const previous = scrollOffsets.current.get(target);
        scrollOffsets.current.set(target, next);
        const restored =
          previous === undefined &&
          target.matches(".messages-timeline-scroll, [data-tool-group-scroll]");
        if (restored || next === (previous ?? "0|0")) return;
      }
      if (!snapshotPrepared.current) return;
      if (active && picturable !== null) snapshots?.invalidate(paneId, true);
      else snapshots?.invalidate(paneId);
      if (picturable === null || !snapshots) return;
      setVisualRevision(snapshots.request(paneId, element));
    };
    const contentChanged = (records: MutationRecord[]) => {
      const attributes = new Map<Element, Set<string>>();
      return records.some((record) => {
        const { target, type, attributeName, oldValue } = record;
        const node = target instanceof Element ? target : target.parentElement;
        if (!node?.closest('[data-chat-composer-surface="true"]'))
          return (
            type === "attributes" &&
            ["aria-expanded", "data-user-message-collapsed", "open"].includes(attributeName ?? "") &&
            oldValue !== node?.getAttribute(attributeName!)
          );
        if (type !== "attributes" || !(target instanceof Element) || attributeName === null)
          return true;
        if (attributeName === "name" || target.matches('[hidden], .hidden, input[type="hidden"]'))
          return false;
        if (
          attributeName === "aria-expanded" &&
          (oldValue ?? "false") === (target.getAttribute(attributeName) ?? "false")
        )
          return false;
        let seen = attributes.get(target);
        if (!seen) attributes.set(target, (seen = new Set()));
        if (seen.has(attributeName)) return false;
        seen.add(attributeName);
        const currentValue = target.getAttribute(attributeName);
        if (attributeName === "style" && target.matches("input, textarea, [contenteditable]")) {
          const pictureStyle = (value: string | null) =>
            (value ?? "")
              .split(";")
              .map((property) => property.trim())
              .filter((property) => property && !/^caret-color\s*:/.test(property))
              .join(";");
          return pictureStyle(oldValue) !== pictureStyle(currentValue);
        }
        if (attributeName === "class" && target.matches('[data-testid="composer-editor"]')) {
          const pictureClasses = (value: string | null) =>
            (value ?? "")
              .split(/\s+/)
              .filter((name) => name !== "ProseMirror-focused")
              .join(" ")
              .trim();
          return pictureClasses(oldValue) !== pictureClasses(currentValue);
        }
        return oldValue !== currentValue;
      });
    };
    const inspectChanges = (records: MutationRecord[]) => {
      if (lifecycle && !lifecycle.isMounted(paneId)) return;
      if (
        snapshotPrepared.current &&
        records.some(
          (record) =>
            record.type === "attributes" &&
            ["aria-expanded", "data-user-message-collapsed", "open"].includes(
              record.attributeName ?? "",
            ) &&
            record.oldValue !== (record.target as Element).getAttribute(record.attributeName!),
        )
      )
        localStateAtRisk.current = true;
      if (records.some(producerChanged)) inspectProducer();
      if (contentChanged(records)) invalidate();
    };
    const observer = new MutationObserver(inspectChanges);
    const stopFlushing = observePaneVisualChanges(paneId, () => {
      inspectChanges(observer.takeRecords());
    });
    observer.observe(element, {
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const events = ["scroll", "input", "drop", "load"] as const;
    for (const event of events)
      element.addEventListener(event, invalidate, { capture: true, passive: true });
    return () => {
      const pending = observer.takeRecords();
      if (element.childElementCount > 0 && (!lifecycle || lifecycle.isMounted(paneId))) {
        if (pending.some(producerChanged)) inspectProducer();
        if (snapshotPrepared.current && contentChanged(pending)) snapshots?.invalidate(paneId);
      }
      stopFlushing();
      observer.disconnect();
      for (const event of events) element.removeEventListener(event, invalidate, true);
    };
  }, [active, lifecycle, mounted, paneId, picturable, snapshots]);
  useEffect(() => {
    if (picturable !== null && contentRef.current && snapshots) {
      setVisualRevision(snapshots.request(paneId, contentRef.current));
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Visibility retries a previously unmeasurable pane.
  }, [active, paneId, picturable, snapshots, visible]);

  useEffect(
    () =>
      router.history.subscribe(({ location }) => {
        if (location.pathname === threadPath) return;
        onNavigateAway(location.href);
        router.history.replace(threadPath);
      }),
    [onNavigateAway, router, threadPath],
  );

  return (
    <ChatPaneControlsContext value={paneControls}>
      <ChatViewActivityContext value={activity}>
        <ComposerHandleContext value={paneComposerRef}>
          <div
            ref={contentRef}
            onPointerDownCapture={() => {
              localStateAtRisk.current = true;
            }}
            onInputCapture={() => {
              localStateAtRisk.current = true;
            }}
            onDropCapture={() => {
              localStateAtRisk.current = true;
            }}
            onPasteCapture={() => {
              localStateAtRisk.current = true;
            }}
            onClickCapture={() => {
              localStateAtRisk.current = true;
            }}
            onKeyDownCapture={(event) => {
              if (
                !event.altKey &&
                !["Escape", "Tab", "Shift", "Control", "Meta", "Alt"].includes(event.key)
              )
                localStateAtRisk.current = true;
              leaveComposerOnEscape(event);
            }}
            className="spatial-thread-pane h-full w-full"
            data-spatial-thread={thread.threadId}
            data-spatial-composer-ready={String(composerReady)}
            data-spatial-timeline-ready={String(mounted && !preparing)}
            data-spatial-active={String(active)}
            data-spatial-preparing={preparing ? "" : undefined}
            data-spatial-capturing={
              mounted && lifecycle?.pictureMount(paneId) === "background" ? "" : undefined
            }
          >
            <ChatViewHostContext value={lifecycle ? host : null}>
              <ChatViewContentReadyProvider onReadyChange={onContentReadyChange}>
                {mounted ? (
                  <PaneScrollState positions={scrollPositions} save={saveScroll} ready={!preparing}>
                    <PaneRouter router={router} threadPath={threadPath} />
                  </PaneScrollState>
                ) : null}
              </ChatViewContentReadyProvider>
            </ChatViewHostContext>
          </div>
        </ComposerHandleContext>
      </ChatViewActivityContext>
    </ChatPaneControlsContext>
  );
});

function TimelinePicture({ paneId, leaving }: { paneId: string; leaving: boolean }) {
  const snapshots = use(PaneSnapshotContext);
  const [picture] = useState(() => snapshots?.timelinePicture(paneId));
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    const pane = element?.closest<HTMLElement>(".spatial-thread-pane");
    if (!element || !pane) return;
    const box = element.getBoundingClientRect();
    const root = pane.getBoundingClientRect();
    const scale = root.width / pane.offsetWidth || 1;
    setOffset({ x: (root.left - box.left) / scale, y: (root.top - box.top) / scale });
  }, [picture?.url]);
  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 overflow-hidden bg-background"
      style={{
        opacity: leaving ? 0 : 1,
        transition: `opacity ${PICTURE_FADE_MS}ms linear`,
        pointerEvents: leaving ? "none" : undefined,
      }}
      aria-hidden="true"
    >
      {picture ? (
        <img
          src={picture.url}
          alt=""
          style={{
            position: "absolute",
            left: offset.x,
            top: offset.y,
            width: picture.width,
            height: picture.height,
            maxWidth: "none",
          }}
        />
      ) : null}
    </div>
  );
}

function PaneScrollState({
  positions,
  save,
  ready,
  children,
}: {
  positions: React.RefObject<{ top: number; atEnd: boolean }[]>;
  save: React.RefObject<(() => void) | null>;
  ready: boolean;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!ready || restored.current || !root.current) return;
    const scrollers = root.current.querySelectorAll<HTMLElement>(
      ".messages-timeline-scroll, [data-tool-group-scroll]",
    );
    scrollers.forEach((element, index) => {
      const saved = positions.current[index];
      if (saved)
        element.scrollTop = saved.atEnd ? element.scrollHeight - element.clientHeight : saved.top;
    });
    restored.current = true;
  }, [positions, ready]);
  useLayoutEffect(() => {
    const element = root.current;
    const remember = () => {
      if (!element || !restored.current) return;
      positions.current = [
        ...element.querySelectorAll<HTMLElement>(
          ".messages-timeline-scroll, [data-tool-group-scroll]",
        ),
      ].map((scroller) => ({
        top: scroller.scrollTop,
        atEnd: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1,
      }));
    };
    save.current = remember;
    return () => {
      remember();
      restored.current = false;
      save.current = null;
    };
  }, [positions, save]);
  return (
    <div ref={root} className="h-full w-full">
      {children}
    </div>
  );
}

export function usePaneComposerHandle(active: boolean): ComposerHandleRef {
  const appComposerRef = useComposerHandleContext();
  const [pane] = useState(() => {
    let handle: ChatComposerHandle | null = null;
    let connected: ComposerHandleRef | null = null;
    return {
      ref: {
        get current() {
          return handle;
        },
        set current(next: ChatComposerHandle | null) {
          if (connected && connected.current === handle) connected.current = next;
          handle = next;
        },
      },
      connect(app: ComposerHandleRef) {
        connected = app;
        app.current = handle;
        return () => {
          if (connected && connected.current === handle) connected.current = null;
          connected = null;
        };
      },
    };
  });
  useLayoutEffect(() => {
    if (active && appComposerRef) return pane.connect(appComposerRef);
  }, [active, appComposerRef, pane]);
  return pane.ref;
}

function leaveComposerOnEscape(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const editor = target.closest<HTMLElement>('[data-testid="composer-editor"]');
  if (!editor || editor.hasAttribute("aria-controls")) return;
  event.preventDefault();
  editor.blur();
}
