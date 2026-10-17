import type {
  OnirigiriLayout,
  OnirigiriPanePictureCaptureListener,
  OnirigiriPanePictureResolver,
  PanePresentationResolver,
} from "@riteofstring/onirigiri";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTheme } from "@t3tools/web/src/hooks/useTheme";
import { useClientSettings } from "@t3tools/web/src/hooks/useSettings";
import { useThreadShells } from "@t3tools/web/src/state/entities";

import {
  MAX_SAVED,
  loadPanePictures,
  deletePanePicture,
  savePanePicture,
  type SavedPanePicture,
} from "./panePictureStore";
import { snapshotPanePicture } from "./panePictureSnapshot";
import { createPanePictureUrls } from "./panePictureUrls";
import { threadPaneId } from "./useWorkspacePanes";

interface PaneContentRevision {
  updatedAt: string;
  theme: string;
}

const syncedPanes = new Map<string, PaneContentRevision & { visualRevision: number }>();

function contentKey(content: PaneContentRevision): string {
  return `${content.updatedAt}|${content.theme}|chat-chrome-2`;
}

function pictureRevision(revision: string, source: SavedPanePicture["source"]): string {
  return source === "capture" ? revision : `${revision}|responsive-css-4`;
}

function paneHasCommittedContent(
  paneId: string,
  expected: PaneContentRevision,
  visualRevision: number,
): boolean {
  const committed = syncedPanes.get(paneId);
  return (
    committed !== undefined &&
    committed.updatedAt >= expected.updatedAt &&
    committed.theme === expected.theme &&
    committed.visualRevision === visualRevision
  );
}

/** Queues an idle picture and returns the visual revision to commit to native readiness. */
export type RequestPaneSnapshot = (
  paneId: string,
  element: HTMLElement,
  options?: { preferNative?: boolean },
) => number;

interface PaneSnapshots {
  geometryVersion: number;
  request: RequestPaneSnapshot;
  invalidate: (paneId: string) => void;
  setLiveProducer: (paneId: string, present: boolean) => number;
}

export const PaneSnapshotContext = createContext<PaneSnapshots | null>(null);

export function usePanePictureTheme(): string {
  const { theme, resolvedTheme, themeHalves } = useTheme();
  const fonts = useClientSettings((settings) =>
    JSON.stringify([
      settings.fontFamilySans,
      settings.fontFamilyCode,
      settings.fontFamilyComposer,
      settings.fontSizeInterface,
      settings.fontSizePrompt,
      settings.fontSizeCode,
      settings.fontSmoothing,
    ]),
  );
  return `${themeHalves?.[resolvedTheme] ?? theme}|${resolvedTheme}|${fonts}`;
}

/** Records the synchronized detail and theme committed by a mounted pane. */
export function markPaneSynced(
  paneId: string,
  content: PaneContentRevision | null,
  visualRevision = 0,
) {
  if (content) syncedPanes.set(paneId, { ...content, visualRevision });
  else syncedPanes.delete(paneId);
}

function paneGeometry(layout: OnirigiriLayout): Map<string, string> {
  const defaults = new Map(layout.panes.map((pane) => [pane.paneId, pane.defaults]));
  return new Map(
    layout.columns.flatMap((column) => {
      const sizing = JSON.stringify([
        column.widthSpec,
        column.cells.map((cell) => [
          cell.heightPx,
          cell.weight,
          typeof cell.paneId === "string" ? defaults.get(cell.paneId) : null,
        ]),
      ]);
      return column.cells.flatMap((cell, index) =>
        typeof cell.paneId === "string" ? [[cell.paneId, `${sizing}|${index}`] as const] : [],
      );
    }),
  );
}

/**
 * Thread pictures saved from earlier sessions. A saved picture seeds its pane
 * while it still shows what the thread would: same last update and theme, and
 * the same pane geometry (stage size, device pixel ratio, column width and
 * cell sizing). Captures of synchronized threads are saved for the next load.
 * Where the browser cannot capture panes, mounted panes are drawn from their
 * DOM when the page is idle; those pictures seed their panes at once and are
 * saved too. A seed never replaces a capture.
 */
export function useSavedPanePictures(
  getLayout: () => OnirigiriLayout | null,
  onSnapshotFailure: (paneId: string, startedAt: number) => void,
  defaultRowHeight: number | "viewport" = "viewport",
): {
  getPanePicture: OnirigiriPanePictureResolver;
  getPanePresentation: PanePresentationResolver;
  onPanePictureCaptured: OnirigiriPanePictureCaptureListener;
  onLayoutChange: (layout: OnirigiriLayout) => void;
  /** A picture validated in this session, retained as cover while its thread refreshes. */
  pictureFor: (paneId: string) => SavedPanePicture | null;
  preparedPictureUrl: (image: Blob) => string | null;
  pictureUrl: (image: Blob) => string;
  hasFreshPicture: (paneId: string) => boolean;
  /** Passive preparation fills free slots; an unpictured visit may replace an older entry. */
  canBackgroundPicture: (paneId: string, visited?: boolean) => boolean;
  runningPanes: ReadonlySet<string>;
  retainedPaneIds: ReadonlySet<string>;
  picturesLoaded: boolean;
  paneSnapshots: PaneSnapshots;
  setCaptureActivity: (enabled: boolean, moving: boolean) => void;
  stageRef: (element: HTMLElement | null) => void;
  stageViewport: { width: number; height: number; compact: boolean };
} {
  const threads = useThreadShells();
  const pictureTheme = usePanePictureTheme();
  const [saved, setSaved] = useState<ReadonlyMap<string, SavedPanePicture> | null>(null);
  const savedRef = useRef(saved);
  // A removed producer still needs its live view until current static pixels exist.
  type Retention = "live" | "awaiting-picture";
  const [retained, setRetained] = useState<ReadonlyMap<string, Retention>>(new Map());
  const retainedRef = useRef(retained);
  const updateRetained = useCallback((next: ReadonlyMap<string, Retention>) => {
    retainedRef.current = next;
    setRetained(next);
  }, []);
  const retainedPaneIds = useMemo(() => new Set(retained.keys()), [retained]);
  const getPanePresentation = useCallback<PanePresentationResolver>(
    (pane) =>
      pane.surfaceKind !== "thread" || retained.get(pane.paneId) === "live" ? "dom" : "auto",
    [retained],
  );
  const updateSaved = useCallback((pictures: Map<string, SavedPanePicture>) => {
    const next =
      pictures.size <= MAX_SAVED
        ? pictures
        : new Map(
            [...pictures.values()]
              .toSorted((a, b) => b.savedAt - a.savedAt)
              .slice(0, MAX_SAVED)
              .map((picture) => [picture.paneId, picture]),
          );
    savedRef.current = next;
    setSaved(next);
  }, []);
  // Session-local visual changes invalidate capture work, but keep the usable
  // cover and persisted data revision until replacement pixels are accepted.
  const visualRevisions = useRef(new Map<string, number>());
  const pictureVisualRevisions = useRef(new WeakMap<Blob, number>());
  const visualRevision = useCallback(
    (paneId: string) => visualRevisions.current.get(paneId) ?? 0,
    [],
  );
  const pictureMatchesVisualRevision = useCallback(
    (paneId: string, image: Blob) =>
      (pictureVisualRevisions.current.get(image) ?? 0) === visualRevision(paneId),
    [visualRevision],
  );
  const paneGeometryRef = useRef<Map<string, string> | null>(null);
  const stageSizeRef = useRef("");
  const [stageViewport, setStageViewport] = useState({ width: 0, height: 0, compact: false });
  const [geometryVersion, setGeometryVersion] = useState(0);
  const defaultRowHeightRef = useRef(defaultRowHeight);
  useLayoutEffect(() => {
    if (defaultRowHeightRef.current === defaultRowHeight) return;
    defaultRowHeightRef.current = defaultRowHeight;
    setGeometryVersion((version) => version + 1);
  }, [defaultRowHeight]);

  useEffect(() => {
    let current = true;
    loadPanePictures()
      .catch(() => new Map<string, SavedPanePicture>())
      .then((pictures) => {
        if (current)
          updateSaved(
            new Map([
              ...[...pictures].filter(([paneId]) => !retainedRef.current.has(paneId)),
              ...(savedRef.current ?? []),
            ]),
          );
      });
    return () => {
      current = false;
    };
  }, [updateSaved]);

  const workspaceElementRef = useRef<HTMLElement | null>(null);
  const observedStageRef = useRef<HTMLElement | null>(null);
  const stopObservingStageRef = useRef<(() => void) | null>(null);
  const observeStage = useCallback(() => {
    const workspace = workspaceElementRef.current;
    if (workspace && observedStageRef.current?.parentElement?.parentElement === workspace) return;
    const stage =
      workspace?.querySelector<HTMLElement>(
        ':scope > [data-onirigiri-slot="workspace"] > [data-onirigiri-slot="stage"]',
      ) ?? null;
    if (stage === observedStageRef.current) return;
    stopObservingStageRef.current?.();
    stopObservingStageRef.current = null;
    observedStageRef.current = stage;
    stageSizeRef.current = "";
    const engine = stage?.parentElement;
    if (!workspace || !stage || !engine) return;
    const syncCompact = () => {
      if (observedStageRef.current !== stage) return;
      const compact = engine.dataset.compactLayout === "true";
      if (workspace.dataset.spatialCompact !== String(compact))
        workspace.dataset.spatialCompact = String(compact);
      setStageViewport((previous) =>
        previous.compact === compact ? previous : { ...previous, compact },
      );
    };
    const compactObserver = new MutationObserver(syncCompact);
    compactObserver.observe(engine, {
      attributes: true,
      attributeFilter: ["data-compact-layout"],
    });
    syncCompact();
    const observer = new ResizeObserver(([entry]) => {
      if (observedStageRef.current !== stage) return;
      const size = entry?.contentRect;
      if (!size || size.width <= 0 || size.height <= 0) return;
      const viewport = {
        width: Math.round(size.width),
        height: Math.round(size.height),
      };
      setStageViewport((previous) =>
        previous.width === viewport.width && previous.height === viewport.height
          ? previous
          : { ...previous, ...viewport },
      );
      const next = `${Math.round(size.width)}x${Math.round(size.height)}`;
      if (stageSizeRef.current === next) return;
      stageSizeRef.current = next;
      setGeometryVersion((version) => version + 1);
    });
    observer.observe(stage);
    let resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const pixelRatioChanged = () => {
      if (observedStageRef.current !== stage) return;
      resolution.removeEventListener("change", pixelRatioChanged);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener("change", pixelRatioChanged);
      setGeometryVersion((version) => version + 1);
    };
    resolution.addEventListener("change", pixelRatioChanged);
    stopObservingStageRef.current = () => {
      compactObserver.disconnect();
      delete workspace.dataset.spatialCompact;
      observer.disconnect();
      resolution.removeEventListener("change", pixelRatioChanged);
    };
  }, []);
  const stageRef = useCallback(
    (element: HTMLElement | null) => {
      workspaceElementRef.current = element;
      observeStage();
    },
    [observeStage],
  );

  const onLayoutChange = useCallback(
    (layout: OnirigiriLayout) => {
      observeStage();
      const next = paneGeometry(layout);
      const previous = paneGeometryRef.current;
      paneGeometryRef.current = next;
      if (
        !previous ||
        previous.size !== next.size ||
        [...next].some(([paneId, sizing]) => previous.get(paneId) !== sizing)
      )
        setGeometryVersion((version) => version + 1);
      if ([...retainedRef.current.keys()].some((paneId) => !next.has(paneId))) {
        updateRetained(new Map([...retainedRef.current].filter(([paneId]) => next.has(paneId))));
      }
    },
    [observeStage, updateRetained],
  );

  const geometryRevision = useCallback(
    (paneId: string) => {
      if (!stageSizeRef.current) return null;
      if (!paneGeometryRef.current) {
        const layout = getLayout();
        if (!layout) return null;
        paneGeometryRef.current = paneGeometry(layout);
      }
      const sizing = paneGeometryRef.current.get(paneId);
      const height = defaultRowHeightRef.current;
      // Older records measured the outer workspace, including its toolbar.
      return sizing
        ? `stage:${stageSizeRef.current}@${window.devicePixelRatio}|${sizing}${height === "viewport" ? "" : `|row:${height}`}`
        : null;
    },
    [getLayout],
  );
  const expectedRevision = useCallback(
    (paneId: string, contents: ReadonlyMap<string, PaneContentRevision>) => {
      const content = contents.get(paneId);
      const geometry = geometryRevision(paneId);
      return content && geometry ? `${contentKey(content)}|${geometry}` : null;
    },
    [geometryRevision],
  );

  const contentRevisions = useMemo(
    () =>
      new Map(
        threads.map((thread) => [
          threadPaneId(thread.environmentId, thread.id),
          { updatedAt: thread.updatedAt, theme: pictureTheme },
        ]),
      ),
    [pictureTheme, threads],
  );
  const contentRevisionsRef = useRef(contentRevisions);
  const runningPanes = useMemo(
    () =>
      new Set(
        threads
          .filter((thread) => threadRuntimeIsActive(thread.runtime))
          .map((thread) => threadPaneId(thread.environmentId, thread.id)),
      ),
    [threads],
  );
  const savedHere = useMemo(
    () => [...(saved?.keys() ?? [])].filter((id) => contentRevisions.has(id)).length,
    [contentRevisions, saved],
  );
  const canBackgroundPicture = useCallback(
    (paneId: string, visited = false) =>
      retained.get(paneId) !== "live" &&
      !runningPanes.has(paneId) &&
      (visited || saved === null || saved.has(paneId) || savedHere < MAX_SAVED),
    [retained, runningPanes, saved, savedHere],
  );
  const runningPanesRef = useRef(runningPanes);
  useLayoutEffect(() => {
    contentRevisionsRef.current = contentRevisions;
    runningPanesRef.current = runningPanes;
  }, [contentRevisions, runningPanes]);

  const freshPictureFor = useCallback(
    (paneId: string): SavedPanePicture | null => {
      if (retainedRef.current.has(paneId)) return null;
      const picture = saved?.get(paneId);
      if (!picture) return null;
      const revision = expectedRevision(paneId, contentRevisions);
      if (!revision || picture.revision !== pictureRevision(revision, picture.source)) return null;
      return picture;
    },
    [contentRevisions, expectedRevision, saved],
  );

  const lastValidPictures = useRef(new Map<string, SavedPanePicture>());
  const [pictureUrls] = useState(createPanePictureUrls);
  const pictureFor = useCallback(
    (paneId: string): SavedPanePicture | null => {
      if (
        retainedRef.current.has(paneId) ||
        !saved?.has(paneId) ||
        !contentRevisionsRef.current.has(paneId)
      ) {
        lastValidPictures.current.delete(paneId);
        return null;
      }
      const picture = saved.get(paneId)!;
      const revision = expectedRevision(paneId, contentRevisionsRef.current);
      const fresh =
        revision && picture.revision === pictureRevision(revision, picture.source) ? picture : null;
      return fresh ?? lastValidPictures.current.get(paneId) ?? null;
    },
    [expectedRevision, saved],
  );
  useLayoutEffect(() => {
    for (const paneId of lastValidPictures.current.keys()) {
      if (retainedRef.current.has(paneId) || !saved?.has(paneId) || !contentRevisions.has(paneId)) {
        lastValidPictures.current.delete(paneId);
      }
    }
    pictureUrls.retain(
      new Set([
        ...[...contentRevisions.keys()].flatMap((paneId) => {
          const picture = freshPictureFor(paneId);
          if (picture) lastValidPictures.current.set(paneId, picture);
          return picture ? [picture.image] : [];
        }),
        ...[...lastValidPictures.current.values()].map((picture) => picture.image),
      ]),
    );
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Observer geometry changes require fresh validation before retaining covers.
  }, [contentRevisions, freshPictureFor, geometryVersion, pictureUrls, retained, saved]);
  useEffect(() => () => pictureUrls.dispose(), [pictureUrls]);
  const hasFreshPicture = useCallback(
    (paneId: string) => {
      const picture = freshPictureFor(paneId);
      return picture !== null && pictureMatchesVisualRevision(paneId, picture.image);
    },
    // oxlint-disable-next-line react/memo-dependencies -- Observer refs need to publish geometry changes to the lifecycle.
    [freshPictureFor, geometryVersion, pictureMatchesVisualRevision],
  );
  const freshPictureForRef = useRef(freshPictureFor);
  useLayoutEffect(() => {
    freshPictureForRef.current = freshPictureFor;
  }, [freshPictureFor]);
  const getPanePicture = useCallback<OnirigiriPanePictureResolver>((pane) => {
    const picture = freshPictureForRef.current(pane.paneId);
    return picture
      ? {
          image: picture.image,
          cssSize: picture.cssSize,
          fit: "fill",
          position: "left top",
          replaceable: true,
        }
      : null;
  }, []);

  const keepPicture = useCallback(
    (picture: SavedPanePicture, revision: number) => {
      pictureVisualRevisions.current.set(picture.image, revision);
      lastValidPictures.current.set(picture.paneId, picture);
      if (retainedRef.current.get(picture.paneId) === "awaiting-picture") {
        const next = new Map(retainedRef.current);
        next.delete(picture.paneId);
        updateRetained(next);
      }
      updateSaved(new Map(savedRef.current ?? []).set(picture.paneId, picture));
      return savePanePicture(
        picture,
        () =>
          retainedRef.current.get(picture.paneId) !== "live" &&
          visualRevision(picture.paneId) === revision &&
          savedRef.current?.get(picture.paneId)?.image === picture.image,
      );
    },
    [updateRetained, updateSaved, visualRevision],
  );

  const onPanePictureCaptured = useCallback<OnirigiriPanePictureCaptureListener>(
    (pane, image, receipt) => {
      if (
        receipt.devicePixelRatio !== window.devicePixelRatio ||
        retainedRef.current.get(pane.paneId) === "live" ||
        runningPanesRef.current.has(pane.paneId)
      )
        return;
      const content = contentRevisionsRef.current.get(pane.paneId);
      const geometry = geometryRevision(pane.paneId);
      const currentVisualRevision = visualRevision(pane.paneId);
      if (
        !content ||
        !geometry ||
        !paneHasCommittedContent(pane.paneId, content, currentVisualRevision)
      )
        return;
      const picture = {
        paneId: pane.paneId,
        revision: `${contentKey(content)}|${geometry}`,
        image,
        cssSize: { width: receipt.bounds.width, height: receipt.bounds.height },
        savedAt: Date.now(),
        source: "capture" as const,
      };
      void keepPicture(picture, currentVisualRevision).catch(() => {});
    },
    [geometryRevision, keepPicture, visualRevision],
  );

  const drawSnapshot = useCallback(
    async (
      paneId: string,
      element: HTMLElement,
      canStart: () => boolean,
      waitToDraw: () => Promise<boolean>,
    ) => {
      const startedAt = performance.now();
      const revision = () => expectedRevision(paneId, contentRevisionsRef.current);
      const before = revision();
      const beforeVisualRevision = visualRevision(paneId);
      if (before === null) return;
      const canSnapshot = () => {
        const content = contentRevisionsRef.current.get(paneId);
        return (
          element.isConnected &&
          retainedRef.current.get(paneId) !== "live" &&
          !runningPanesRef.current.has(paneId) &&
          revision() === before &&
          visualRevision(paneId) === beforeVisualRevision &&
          content !== undefined &&
          paneHasCommittedContent(paneId, content, beforeVisualRevision) &&
          canStart()
        );
      };
      if (!canSnapshot()) return;
      const previous = savedRef.current?.get(paneId);
      if (
        previous?.revision === pictureRevision(before, previous?.source) &&
        pictureMatchesVisualRevision(paneId, previous.image)
      )
        return;
      // A capture of the same content is more faithful than a drawing.
      const captured = () => {
        const kept = savedRef.current?.get(paneId);
        return (
          kept?.source === "capture" &&
          kept.revision === before &&
          pictureMatchesVisualRevision(paneId, kept.image)
        );
      };
      if (captured()) return;
      // The clone no longer depends on a mounted pane while its pixels are encoded.
      const current = () =>
        retainedRef.current.get(paneId) !== "live" &&
        !runningPanesRef.current.has(paneId) &&
        revision() === before &&
        visualRevision(paneId) === beforeVisualRevision &&
        !captured();
      const snapshot = await snapshotPanePicture(
        element,
        canSnapshot,
        async () => (await waitToDraw()) && current(),
      ).catch(() => null);
      if (!snapshot) {
        if (current() && canSnapshot()) onSnapshotFailure(paneId, startedAt);
        return;
      }
      if (!current()) return;
      const picture = {
        paneId,
        revision: pictureRevision(before, "snapshot"),
        image: snapshot.image,
        cssSize: snapshot.cssSize,
        savedAt: Date.now(),
        source: "snapshot" as const,
      };
      await keepPicture(picture, beforeVisualRevision);
    },
    [
      expectedRevision,
      keepPicture,
      onSnapshotFailure,
      pictureMatchesVisualRevision,
      visualRevision,
    ],
  );
  const drawSnapshotRef = useRef(drawSnapshot);
  useLayoutEffect(() => {
    drawSnapshotRef.current = drawSnapshot;
  }, [drawSnapshot]);
  const [snapshots] = useState(createSnapshotQueue);
  useEffect(
    () =>
      snapshots.setDraw(
        (...args) => drawSnapshotRef.current(...args),
        (paneId) => {
          const revision = expectedRevision(paneId, contentRevisionsRef.current);
          if (
            !revision ||
            retainedRef.current.get(paneId) === "live" ||
            runningPanesRef.current.has(paneId) ||
            !syncedPanes.has(paneId)
          )
            return false;
          const previous = savedRef.current?.get(paneId);
          return (
            !previous ||
            previous.revision !== pictureRevision(revision, previous.source) ||
            !pictureMatchesVisualRevision(paneId, previous.image)
          );
        },
        (paneId) => lastValidPictures.current.has(paneId),
      ),
    [expectedRevision, pictureMatchesVisualRevision, snapshots],
  );
  const paneSnapshots = useMemo<PaneSnapshots>(
    () => ({
      geometryVersion,
      invalidate: (paneId) => {
        visualRevisions.current.set(paneId, visualRevision(paneId) + 1);
      },
      setLiveProducer: (paneId, present) => {
        const previous = retainedRef.current.get(paneId);
        if (present === (previous === "live")) return visualRevision(paneId);
        const next = new Map(retainedRef.current);
        next.set(paneId, present ? "live" : "awaiting-picture");
        updateRetained(next);
        visualRevisions.current.set(paneId, visualRevision(paneId) + 1);
        lastValidPictures.current.delete(paneId);
        if (savedRef.current?.has(paneId)) {
          const pictures = new Map(savedRef.current);
          pictures.delete(paneId);
          updateSaved(pictures);
        }
        if (present) void deletePanePicture(paneId).catch(() => {});
        return visualRevision(paneId);
      },
      request: (paneId, element, options) => {
        snapshots.request(paneId, element, options?.preferNative === true);
        return visualRevision(paneId);
      },
    }),
    [geometryVersion, snapshots, updateRetained, updateSaved, visualRevision],
  );

  return {
    getPanePicture,
    getPanePresentation,
    onPanePictureCaptured,
    onLayoutChange,
    pictureFor,
    preparedPictureUrl: pictureUrls.preparedUrl,
    pictureUrl: pictureUrls.urlFor,
    hasFreshPicture,
    canBackgroundPicture,
    runningPanes,
    retainedPaneIds,
    picturesLoaded: saved !== null,
    paneSnapshots,
    setCaptureActivity: snapshots.setActivity,
    stageRef,
    stageViewport,
  };
}

// Draws one requested snapshot at a time while the page is idle; a newer
// request for a pane replaces one still waiting.
const SNAPSHOT_INPUT_QUIET_MS = 3000;
const FIRST_PICTURE_INPUT_QUIET_MS = 400;
const NATIVE_CAPTURE_GRACE_MS = 2000;
const SNAPSHOT_RETRY_LIMIT_MS = 5 * 60_000;

export function createSnapshotQueue() {
  type Draw = (
    paneId: string,
    element: HTMLElement,
    canStart: () => boolean,
    waitToDraw: () => Promise<boolean>,
  ) => Promise<void>;
  const pending = new Map<string, { element: HTMLElement; after: number; retryAfter: number }>();
  let draw: Draw | null = null;
  let needsPicture: (paneId: string) => boolean = () => false;
  let hasCover: (paneId: string) => boolean = () => false;
  let enabled = true;
  let moving = false;
  let drawing = false;
  let continuation: { paneId: string; resolve: (admitted: boolean) => void } | null = null;
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInput = performance.now();
  const noteInput = () => {
    lastInput = performance.now();
  };
  const inputEvents = ["keydown", "pointerdown", "wheel"] as const;
  const quietTime = (paneId: string) =>
    hasCover(paneId) ? SNAPSHOT_INPUT_QUIET_MS : FIRST_PICTURE_INPUT_QUIET_MS;
  const cancelScheduled = () => {
    if (idle !== null) cancelIdleCallback(idle);
    if (timer !== null) clearTimeout(timer);
    idle = null;
    timer = null;
  };
  const next = () => {
    if (
      !enabled ||
      moving ||
      (drawing && !continuation) ||
      idle !== null ||
      timer !== null ||
      (!continuation && pending.size === 0) ||
      !draw
    )
      return;
    const current = draw;
    idle = requestIdleCallback(
      (deadline) => {
        idle = null;
        if (draw !== current || (!continuation && pending.size === 0)) return;
        if (deadline.timeRemaining() < 4) {
          next();
          return;
        }
        const now = performance.now();
        const due = ([paneId, request]: [string, { after: number }]) =>
          Math.max(lastInput + quietTime(paneId), request.after);
        const [paneId, request] = continuation
          ? ([continuation.paneId, null] as const)
          : [...pending].reduce((first, candidate) =>
              due(candidate) < due(first) ? candidate : first,
            );
        const wait = due([paneId, request ?? { after: 0 }]) - now;
        if (wait > 0) {
          timer = setTimeout(() => {
            timer = null;
            next();
          }, wait);
          return;
        }
        if (!request) {
          const resume = continuation!;
          continuation = null;
          resume.resolve(true);
          return;
        }
        pending.delete(paneId);
        drawing = true;
        let deferred = false;
        const canStart = () => {
          if (!enabled || moving || performance.now() - lastInput < quietTime(paneId))
            deferred = true;
          return !deferred && draw === current;
        };
        const waitToDraw = () => {
          if (draw !== current) return Promise.resolve(false);
          return new Promise<boolean>((resolve) => {
            continuation = { paneId, resolve };
            next();
          });
        };
        void current(paneId, request.element, canStart, waitToDraw)
          .catch(() => {})
          .finally(() => {
            drawing = false;
            if (draw === current && !pending.has(paneId)) {
              if (deferred) pending.set(paneId, request);
              else if (request.element.isConnected && needsPicture(paneId)) {
                pending.set(paneId, {
                  ...request,
                  after: performance.now() + request.retryAfter,
                  retryAfter: Math.min(request.retryAfter * 2, SNAPSHOT_RETRY_LIMIT_MS),
                });
              }
            }
            next();
          });
      },
      { timeout: 4000 },
    );
  };
  const request = (paneId: string, element: HTMLElement, preferNative: boolean) => {
    pending.set(paneId, {
      element,
      after: Math.min(
        pending.get(paneId)?.after ?? Infinity,
        performance.now() + (preferNative ? NATIVE_CAPTURE_GRACE_MS : 0),
      ),
      retryAfter: SNAPSHOT_INPUT_QUIET_MS,
    });
    if (timer !== null) clearTimeout(timer);
    timer = null;
    next();
  };
  const setDraw = (
    nextDraw: Draw,
    nextNeedsPicture: (paneId: string) => boolean,
    nextHasCover: (paneId: string) => boolean,
  ) => {
    draw = nextDraw;
    needsPicture = nextNeedsPicture;
    hasCover = nextHasCover;
    for (const type of inputEvents) {
      window.addEventListener(type, noteInput, { capture: true, passive: true });
    }
    next();
    return () => {
      if (draw !== nextDraw) return;
      draw = null;
      pending.clear();
      cancelScheduled();
      continuation?.resolve(false);
      continuation = null;
      for (const type of inputEvents) {
        window.removeEventListener(type, noteInput, { capture: true });
      }
    };
  };
  const setActivity = (nextEnabled: boolean, nextMoving: boolean) => {
    if (enabled === nextEnabled && moving === nextMoving) return;
    if (nextMoving && !moving) noteInput();
    enabled = nextEnabled;
    moving = nextMoving;
    cancelScheduled();
    next();
  };
  return { request, setDraw, setActivity };
}
