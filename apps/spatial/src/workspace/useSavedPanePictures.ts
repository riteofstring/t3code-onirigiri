import type {
  OnirigiriLayout,
  OnirigiriPanePictureCaptureListener,
  OnirigiriPanePictureResolver,
  PanePresentationResolver,
} from "@riteofstring/onirigiri";
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
  return `${content.updatedAt}|${content.theme}`;
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

function columnWidths(layout: OnirigiriLayout): Map<string, string> {
  return new Map(
    layout.columns.flatMap((column) => {
      const width = JSON.stringify(column.widthSpec);
      return column.cells.flatMap((cell) =>
        typeof cell.paneId === "string" ? [[cell.paneId, width] as const] : [],
      );
    }),
  );
}

/**
 * Thread pictures saved from earlier sessions. A saved picture seeds its pane
 * while it still shows what the thread would: same last update and theme, and
 * the same pane geometry (workspace size, device pixel ratio and column
 * width). Captures of fully synchronized threads are saved for the next load.
 * Where the browser cannot capture panes, mounted panes are drawn from their
 * DOM when the page is idle; those pictures seed their panes at once and are
 * saved too. A seed never replaces a capture.
 */
export function useSavedPanePictures(getLayout: () => OnirigiriLayout | null): {
  getPanePicture: OnirigiriPanePictureResolver;
  getPanePresentation: PanePresentationResolver;
  onPanePictureCaptured: OnirigiriPanePictureCaptureListener;
  onLayoutChange: (layout: OnirigiriLayout) => void;
  /** A picture validated in this session, retained as cover while its thread refreshes. */
  pictureFor: (paneId: string) => Blob | null;
  preparedPictureUrl: (image: Blob) => string | null;
  pictureUrl: (image: Blob) => string;
  hasFreshPicture: (paneId: string) => boolean;
  /** Passive preparation fills free slots or refreshes existing pictures. */
  canBackgroundPicture: (paneId: string) => boolean;
  runningPanes: ReadonlySet<string>;
  retainedPaneIds: ReadonlySet<string>;
  picturesLoaded: boolean;
  paneSnapshots: PaneSnapshots;
  stageRef: (element: HTMLElement | null) => void;
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
    (pane) => (retained.get(pane.paneId) === "live" ? "dom" : "auto"),
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
  const widthsRef = useRef<Map<string, string> | null>(null);
  const stageSizeRef = useRef("");
  const [geometryVersion, setGeometryVersion] = useState(0);

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

  const stageObserverRef = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((element: HTMLElement | null) => {
    stageObserverRef.current?.disconnect();
    stageObserverRef.current = null;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.contentRect;
      if (!size || size.width <= 0 || size.height <= 0) return;
      const next = `${Math.round(size.width)}x${Math.round(size.height)}`;
      if (stageSizeRef.current === next) return;
      stageSizeRef.current = next;
      setGeometryVersion((version) => version + 1);
    });
    observer.observe(element);
    stageObserverRef.current = observer;
  }, []);

  const onLayoutChange = useCallback(
    (layout: OnirigiriLayout) => {
      const next = columnWidths(layout);
      const previous = widthsRef.current;
      widthsRef.current = next;
      if (
        !previous ||
        previous.size !== next.size ||
        [...next].some(([paneId, width]) => previous.get(paneId) !== width)
      )
        setGeometryVersion((version) => version + 1);
      if ([...retainedRef.current.keys()].some((paneId) => !next.has(paneId))) {
        updateRetained(new Map([...retainedRef.current].filter(([paneId]) => next.has(paneId))));
      }
    },
    [updateRetained],
  );

  const geometryRevision = useCallback(
    (paneId: string) => {
      if (!stageSizeRef.current) return null;
      if (!widthsRef.current) {
        const layout = getLayout();
        if (!layout) return null;
        widthsRef.current = columnWidths(layout);
      }
      const width = widthsRef.current.get(paneId);
      return width ? `${stageSizeRef.current}@${window.devicePixelRatio}|${width}` : null;
    },
    [getLayout],
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
          .filter((thread) => thread.latestTurn?.state === "running")
          .map((thread) => threadPaneId(thread.environmentId, thread.id)),
      ),
    [threads],
  );
  const canBackgroundPicture = useCallback(
    (paneId: string) =>
      retained.get(paneId) !== "live" &&
      !runningPanes.has(paneId) &&
      (saved === null || saved.size < MAX_SAVED || saved.has(paneId)),
    [retained, runningPanes, saved],
  );
  const runningPanesRef = useRef(runningPanes);
  useLayoutEffect(() => {
    contentRevisionsRef.current = contentRevisions;
    runningPanesRef.current = runningPanes;
  }, [contentRevisions, runningPanes]);

  const freshPictureFor = useCallback(
    (paneId: string): Blob | null => {
      if (retainedRef.current.has(paneId)) return null;
      const picture = saved?.get(paneId);
      if (!picture) return null;
      const content = contentRevisions.get(paneId);
      const geometry = geometryRevision(paneId);
      if (
        !content ||
        !geometry ||
        picture.revision !== pictureRevision(`${contentKey(content)}|${geometry}`, picture.source)
      )
        return null;
      return picture.image;
    },
    [contentRevisions, geometryRevision, saved],
  );

  const lastValidPictures = useRef(new Map<string, Blob>());
  const [pictureUrls] = useState(createPanePictureUrls);
  const pictureFor = useCallback(
    (paneId: string): Blob | null => {
      if (
        retainedRef.current.has(paneId) ||
        !saved?.has(paneId) ||
        !contentRevisionsRef.current.has(paneId)
      ) {
        lastValidPictures.current.delete(paneId);
        return null;
      }
      const picture = saved.get(paneId)!;
      const content = contentRevisionsRef.current.get(paneId);
      const geometry = geometryRevision(paneId);
      const fresh =
        content &&
        geometry &&
        picture.revision === pictureRevision(`${contentKey(content)}|${geometry}`, picture.source)
          ? picture.image
          : null;
      return fresh ?? lastValidPictures.current.get(paneId) ?? null;
    },
    [geometryRevision, saved],
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
          const image = freshPictureFor(paneId);
          if (image) lastValidPictures.current.set(paneId, image);
          return image ? [image] : [];
        }),
        ...lastValidPictures.current.values(),
      ]),
    );
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Observer geometry changes require fresh validation before retaining covers.
  }, [contentRevisions, freshPictureFor, geometryVersion, pictureUrls, retained, saved]);
  useEffect(() => () => pictureUrls.dispose(), [pictureUrls]);
  const hasFreshPicture = useCallback(
    (paneId: string) => freshPictureFor(paneId) !== null,
    // oxlint-disable-next-line react/memo-dependencies -- Observer refs need to publish geometry changes to the lifecycle.
    [freshPictureFor, geometryVersion],
  );
  const freshPictureForRef = useRef(freshPictureFor);
  useLayoutEffect(() => {
    freshPictureForRef.current = freshPictureFor;
  }, [freshPictureFor]);
  const getPanePicture = useCallback<OnirigiriPanePictureResolver>((pane) => {
    const image = freshPictureForRef.current(pane.paneId);
    return image ? { image, fit: "fill", replaceable: true } : null;
  }, []);

  const keepPicture = useCallback(
    (picture: SavedPanePicture, revision: number) => {
      pictureVisualRevisions.current.set(picture.image, revision);
      lastValidPictures.current.set(picture.paneId, picture.image);
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
    (pane, image) => {
      if (
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
        savedAt: Date.now(),
        source: "capture" as const,
      };
      void keepPicture(picture, currentVisualRevision).catch(() => {});
    },
    [geometryRevision, keepPicture, visualRevision],
  );

  const drawSnapshot = useCallback(
    async (paneId: string, element: HTMLElement, canStart: () => boolean) => {
      const revision = () => {
        const content = contentRevisionsRef.current.get(paneId);
        const geometry = geometryRevision(paneId);
        return content && geometry ? `${contentKey(content)}|${geometry}` : null;
      };
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
      const image = await snapshotPanePicture(element, canSnapshot);
      // The clone no longer depends on a mounted pane while its pixels are encoded.
      if (
        !image ||
        retainedRef.current.get(paneId) === "live" ||
        runningPanesRef.current.has(paneId) ||
        revision() !== before ||
        visualRevision(paneId) !== beforeVisualRevision ||
        captured()
      )
        return;
      const picture = {
        paneId,
        revision: pictureRevision(before, "snapshot"),
        image,
        savedAt: Date.now(),
        source: "snapshot" as const,
      };
      await keepPicture(picture, beforeVisualRevision);
    },
    [geometryRevision, keepPicture, pictureMatchesVisualRevision, visualRevision],
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
          const content = contentRevisionsRef.current.get(paneId);
          const geometry = geometryRevision(paneId);
          if (
            !content ||
            !geometry ||
            retainedRef.current.get(paneId) === "live" ||
            runningPanesRef.current.has(paneId) ||
            !syncedPanes.has(paneId)
          )
            return false;
          const previous = savedRef.current?.get(paneId);
          return (
            !previous ||
            previous.revision !==
              pictureRevision(`${contentKey(content)}|${geometry}`, previous.source) ||
            !pictureMatchesVisualRevision(paneId, previous.image)
          );
        },
      ),
    [geometryRevision, pictureMatchesVisualRevision, snapshots],
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
    stageRef,
  };
}

// Draws one requested snapshot at a time while the page is idle; a newer
// request for a pane replaces one still waiting.
const SNAPSHOT_INPUT_QUIET_MS = 3000;
const NATIVE_CAPTURE_GRACE_MS = 2000;
const SNAPSHOT_RETRY_LIMIT_MS = 5 * 60_000;

export function createSnapshotQueue() {
  type Draw = (paneId: string, element: HTMLElement, canStart: () => boolean) => Promise<void>;
  const pending = new Map<string, { element: HTMLElement; after: number; retryAfter: number }>();
  let draw: Draw | null = null;
  let needsPicture: (paneId: string) => boolean = () => false;
  let drawing = false;
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInput = performance.now();
  const noteInput = () => {
    lastInput = performance.now();
  };
  const inputEvents = ["keydown", "pointerdown", "wheel"] as const;
  const next = () => {
    if (drawing || idle !== null || timer !== null || pending.size === 0 || !draw) return;
    const current = draw;
    idle = requestIdleCallback(
      () => {
        idle = null;
        if (draw !== current || pending.size === 0) return;
        // Drawing waits until input has been quiet for a moment.
        const now = performance.now();
        const [paneId, request] = [...pending].reduce((first, candidate) =>
          candidate[1].after < first[1].after ? candidate : first,
        );
        const wait = Math.max(lastInput + SNAPSHOT_INPUT_QUIET_MS, request.after) - now;
        if (wait > 0) {
          timer = setTimeout(() => {
            timer = null;
            next();
          }, wait);
          return;
        }
        pending.delete(paneId);
        drawing = true;
        let deferred = false;
        const canStart = () => {
          if (performance.now() - lastInput < SNAPSHOT_INPUT_QUIET_MS) deferred = true;
          return !deferred && draw === current;
        };
        void current(paneId, request.element, canStart)
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
      after: performance.now() + (preferNative ? NATIVE_CAPTURE_GRACE_MS : 0),
      retryAfter: SNAPSHOT_INPUT_QUIET_MS,
    });
    if (timer !== null) clearTimeout(timer);
    timer = null;
    next();
  };
  const setDraw = (nextDraw: Draw, nextNeedsPicture: (paneId: string) => boolean) => {
    draw = nextDraw;
    needsPicture = nextNeedsPicture;
    for (const type of inputEvents) {
      window.addEventListener(type, noteInput, { capture: true, passive: true });
    }
    next();
    return () => {
      if (draw !== nextDraw) return;
      draw = null;
      pending.clear();
      if (idle !== null) cancelIdleCallback(idle);
      if (timer !== null) clearTimeout(timer);
      idle = null;
      timer = null;
      for (const type of inputEvents) {
        window.removeEventListener(type, noteInput, { capture: true });
      }
    };
  };
  return { request, setDraw };
}
