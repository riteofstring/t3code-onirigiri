import type {
  OnirigiriLayout,
  OnirigiriPanePictureCaptureListener,
  OnirigiriPanePictureResolver,
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
import { useThreadShells } from "@t3tools/web/src/state/entities";

import {
  MAX_SAVED,
  loadPanePictures,
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

const syncedPanes = new Map<string, PaneContentRevision>();

function contentKey(content: PaneContentRevision): string {
  return `${content.updatedAt}|${content.theme}`;
}

function pictureRevision(revision: string, source: SavedPanePicture["source"]): string {
  return source === "capture" ? revision : `${revision}|responsive-css-2`;
}

function paneHasCommittedContent(paneId: string, expected: PaneContentRevision): boolean {
  const committed = syncedPanes.get(paneId);
  return (
    committed !== undefined &&
    committed.updatedAt >= expected.updatedAt &&
    committed.theme === expected.theme
  );
}

/** Asks for a picture of a mounted pane's content to be drawn when the page is idle. */
export type RequestPaneSnapshot = (
  paneId: string,
  element: HTMLElement,
  options?: { preferNative?: boolean; refresh?: boolean },
) => void;

export const PaneSnapshotContext = createContext<RequestPaneSnapshot | null>(null);

export function usePanePictureTheme(): string {
  const { theme, resolvedTheme, themeHalves } = useTheme();
  return `${themeHalves?.[resolvedTheme] ?? theme}|${resolvedTheme}`;
}

/** Records the synchronized detail and theme committed by a mounted pane. */
export function markPaneSynced(paneId: string, content: PaneContentRevision | null) {
  if (content) syncedPanes.set(paneId, content);
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
  picturesLoaded: boolean;
  requestSnapshot: RequestPaneSnapshot;
  stageRef: (element: HTMLElement | null) => void;
} {
  const threads = useThreadShells();
  const pictureTheme = usePanePictureTheme();
  const [saved, setSaved] = useState<ReadonlyMap<string, SavedPanePicture> | null>(null);
  const widthsRef = useRef<Map<string, string> | null>(null);
  const stageSizeRef = useRef("");
  const [geometryVersion, setGeometryVersion] = useState(0);

  useEffect(() => {
    let current = true;
    loadPanePictures()
      .catch(() => new Map<string, SavedPanePicture>())
      .then((pictures) => {
        if (current) setSaved(pictures);
      });
    return () => {
      current = false;
    };
  }, []);

  const stageObserverRef = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((element: HTMLElement | null) => {
    stageObserverRef.current?.disconnect();
    stageObserverRef.current = null;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.contentRect;
      if (!size) return;
      const next = `${Math.round(size.width)}x${Math.round(size.height)}`;
      if (stageSizeRef.current === next) return;
      stageSizeRef.current = next;
      setGeometryVersion((version) => version + 1);
    });
    observer.observe(element);
    stageObserverRef.current = observer;
  }, []);

  const onLayoutChange = useCallback((layout: OnirigiriLayout) => {
    const next = columnWidths(layout);
    const previous = widthsRef.current;
    widthsRef.current = next;
    if (
      !previous ||
      previous.size !== next.size ||
      [...next].some(([paneId, width]) => previous.get(paneId) !== width)
    )
      setGeometryVersion((version) => version + 1);
  }, []);

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
      !runningPanes.has(paneId) && (saved === null || saved.size < MAX_SAVED || saved.has(paneId)),
    [runningPanes, saved],
  );
  const runningPanesRef = useRef(runningPanes);
  useLayoutEffect(() => {
    contentRevisionsRef.current = contentRevisions;
    runningPanesRef.current = runningPanes;
  }, [contentRevisions, runningPanes]);

  const freshPictureFor = useCallback(
    (paneId: string): Blob | null => {
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
      if (!saved?.has(paneId) || !contentRevisionsRef.current.has(paneId)) {
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
      if (fresh) lastValidPictures.current.set(paneId, fresh);
      return fresh ?? lastValidPictures.current.get(paneId) ?? null;
    },
    [geometryRevision, saved],
  );
  useEffect(() => {
    for (const paneId of lastValidPictures.current.keys()) {
      if (!saved?.has(paneId) || !contentRevisions.has(paneId)) {
        lastValidPictures.current.delete(paneId);
      }
    }
    pictureUrls.retain(
      new Set([
        ...[...contentRevisions.keys()].flatMap((paneId) => {
          const image = freshPictureFor(paneId);
          return image ? [image] : [];
        }),
        ...lastValidPictures.current.values(),
      ]),
    );
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Geometry changes can replace the retained cover read during render.
  }, [contentRevisions, freshPictureFor, geometryVersion, pictureUrls, saved]);
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

  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  const keepPicture = useCallback((picture: SavedPanePicture) => {
    setSaved((current) => {
      const next = new Map(current ?? []).set(picture.paneId, picture);
      if (next.size <= MAX_SAVED) return next;
      const newest = [...next.values()].toSorted((a, b) => b.savedAt - a.savedAt);
      return new Map(newest.slice(0, MAX_SAVED).map((kept) => [kept.paneId, kept]));
    });
  }, []);

  const onPanePictureCaptured = useCallback<OnirigiriPanePictureCaptureListener>(
    (pane, image) => {
      if (runningPanesRef.current.has(pane.paneId)) return;
      const content = contentRevisionsRef.current.get(pane.paneId);
      const geometry = geometryRevision(pane.paneId);
      if (!content || !geometry || !paneHasCommittedContent(pane.paneId, content)) return;
      const picture = {
        paneId: pane.paneId,
        revision: `${contentKey(content)}|${geometry}`,
        image,
        savedAt: Date.now(),
        source: "capture" as const,
      };
      keepPicture(picture);
      void savePanePicture(picture).catch(() => {});
    },
    [geometryRevision, keepPicture],
  );

  const drawSnapshot = useCallback(
    async (paneId: string, element: HTMLElement, refresh: boolean, canStart: () => boolean) => {
      const revision = () => {
        const content = contentRevisionsRef.current.get(paneId);
        const geometry = geometryRevision(paneId);
        return content && geometry ? `${contentKey(content)}|${geometry}` : null;
      };
      const before = revision();
      if (before === null) return;
      const canSnapshot = () => {
        const content = contentRevisionsRef.current.get(paneId);
        return (
          element.isConnected &&
          !runningPanesRef.current.has(paneId) &&
          revision() === before &&
          content !== undefined &&
          paneHasCommittedContent(paneId, content) &&
          canStart()
        );
      };
      if (!canSnapshot()) return;
      const previous = savedRef.current?.get(paneId);
      if (!refresh && previous?.revision === pictureRevision(before, previous?.source)) return;
      // A capture of the same content is more faithful than a drawing.
      const captured = () => {
        const kept = savedRef.current?.get(paneId);
        return kept?.source === "capture" && kept.revision === before;
      };
      if (captured()) return;
      const image = await snapshotPanePicture(element, canSnapshot);
      // The clone no longer depends on a mounted pane while its pixels are encoded.
      if (!image || runningPanesRef.current.has(paneId) || revision() !== before || captured())
        return;
      const picture = {
        paneId,
        revision: pictureRevision(before, "snapshot"),
        image,
        savedAt: Date.now(),
        source: "snapshot" as const,
      };
      keepPicture(picture);
      await savePanePicture(picture);
    },
    [geometryRevision, keepPicture],
  );
  const [snapshots] = useState(createSnapshotQueue);
  useEffect(() => snapshots.setDraw(drawSnapshot), [drawSnapshot, snapshots]);

  return {
    getPanePicture,
    onPanePictureCaptured,
    onLayoutChange,
    pictureFor,
    preparedPictureUrl: pictureUrls.preparedUrl,
    pictureUrl: pictureUrls.urlFor,
    hasFreshPicture,
    canBackgroundPicture,
    runningPanes,
    picturesLoaded: saved !== null,
    requestSnapshot: snapshots.request,
    stageRef,
  };
}

// Draws one requested snapshot at a time while the page is idle; a newer
// request for a pane replaces one still waiting.
const SNAPSHOT_INPUT_QUIET_MS = 3000;
const NATIVE_CAPTURE_GRACE_MS = 2000;

export function createSnapshotQueue() {
  type Draw = (
    paneId: string,
    element: HTMLElement,
    refresh: boolean,
    canStart: () => boolean,
  ) => Promise<void>;
  const pending = new Map<string, { element: HTMLElement; after: number; refresh: boolean }>();
  let draw: Draw | null = null;
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
        void current(paneId, request.element, request.refresh, canStart)
          .catch(() => {})
          .finally(() => {
            drawing = false;
            if (deferred && draw === current) {
              const latest = pending.get(paneId);
              pending.set(paneId, {
                ...(latest ?? request),
                refresh: request.refresh || latest?.refresh === true,
              });
            }
            next();
          });
      },
      { timeout: 4000 },
    );
  };
  const request: RequestPaneSnapshot = (paneId, element, options = {}) => {
    pending.set(paneId, {
      element,
      after: performance.now() + (options.preferNative ? NATIVE_CAPTURE_GRACE_MS : 0),
      refresh: options.refresh === true || pending.get(paneId)?.refresh === true,
    });
    if (timer !== null) clearTimeout(timer);
    timer = null;
    next();
  };
  const setDraw = (nextDraw: Draw) => {
    draw = nextDraw;
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
