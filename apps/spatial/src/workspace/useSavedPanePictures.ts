import type {
  OnirigiriLayout,
  OnirigiriPanePictureCaptureListener,
  OnirigiriPanePictureResolver,
} from "@riteofstring/onirigiri";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@t3tools/web/src/hooks/useTheme";
import { useThreadShells } from "@t3tools/web/src/state/entities";

import { loadPanePictures, savePanePicture, type SavedPanePicture } from "./panePictureStore";
import { threadPaneId } from "./useWorkspacePanes";

const syncedPanes = new Set<string>();

/** Records whether a mounted pane shows its thread fully synchronized. */
export function markPaneSynced(paneId: string, synced: boolean) {
  if (synced) syncedPanes.add(paneId);
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
 * width). Captures of fully synchronized threads are saved for the next load;
 * the seeds themselves come only from the load, so a capture is never
 * replaced by its own saved copy.
 */
export function useSavedPanePictures(getLayout: () => OnirigiriLayout | null): {
  getPanePicture: OnirigiriPanePictureResolver;
  onPanePictureCaptured: OnirigiriPanePictureCaptureListener;
  onLayoutChange: (layout: OnirigiriLayout) => void;
  stageRef: (element: HTMLElement | null) => void;
} {
  const threads = useThreadShells();
  const { resolvedTheme } = useTheme();
  const [saved, setSaved] = useState<ReadonlyMap<string, SavedPanePicture> | null>(null);
  const widthsRef = useRef<Map<string, string> | null>(null);
  const stageSizeRef = useRef("");

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
      if (size) stageSizeRef.current = `${Math.round(size.width)}x${Math.round(size.height)}`;
    });
    observer.observe(element);
    stageObserverRef.current = observer;
  }, []);

  const onLayoutChange = useCallback((layout: OnirigiriLayout) => {
    widthsRef.current = columnWidths(layout);
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
          `${thread.updatedAt}|${resolvedTheme}`,
        ]),
      ),
    [resolvedTheme, threads],
  );
  const contentRevisionsRef = useRef(contentRevisions);
  useEffect(() => {
    contentRevisionsRef.current = contentRevisions;
  }, [contentRevisions]);

  const getPanePicture = useMemo((): OnirigiriPanePictureResolver => {
    return (pane) => {
      const picture = saved?.get(pane.paneId);
      if (!picture) return null;
      const content = contentRevisions.get(pane.paneId);
      const geometry = geometryRevision(pane.paneId);
      if (!content || !geometry || picture.revision !== `${content}|${geometry}`) return null;
      return { image: picture.image, fit: "fill", replaceable: true };
    };
  }, [contentRevisions, geometryRevision, saved]);

  const onPanePictureCaptured = useCallback<OnirigiriPanePictureCaptureListener>(
    (pane, image) => {
      if (!syncedPanes.has(pane.paneId)) return;
      const content = contentRevisionsRef.current.get(pane.paneId);
      const geometry = geometryRevision(pane.paneId);
      if (!content || !geometry) return;
      void savePanePicture({
        paneId: pane.paneId,
        revision: `${content}|${geometry}`,
        image,
        savedAt: Date.now(),
      }).catch(() => {});
    },
    [geometryRevision],
  );

  return { getPanePicture, onPanePictureCaptured, onLayoutChange, stageRef };
}
