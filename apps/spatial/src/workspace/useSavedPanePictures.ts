import type {
  OnirigiriPanePictureCaptureListener,
  OnirigiriPanePictureResolver,
} from "@riteofstring/onirigiri";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@t3tools/web/src/hooks/useTheme";
import { useThreadShells } from "@t3tools/web/src/state/entities";

import {
  loadPanePictures,
  savePanePicture,
  viewportRevision,
  type SavedPanePicture,
} from "./panePictureStore";
import { threadPaneId } from "./useWorkspacePanes";

/**
 * Thread pictures saved from earlier sessions. A saved picture seeds its pane
 * while it still shows what the thread would: same last update, theme and
 * viewport. Each capture the workspace accepts is saved for the next load;
 * the seeds themselves come only from the load, so a capture is never
 * replaced by its own saved copy.
 */
export function useSavedPanePictures(): {
  getPanePicture: OnirigiriPanePictureResolver;
  onPanePictureCaptured: OnirigiriPanePictureCaptureListener;
} {
  const threads = useThreadShells();
  const { resolvedTheme } = useTheme();
  const [saved, setSaved] = useState<ReadonlyMap<string, SavedPanePicture> | null>(null);

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
      const content = contentRevisions.get(pane.paneId);
      if (!picture || !content || picture.revision !== `${content}|${viewportRevision()}`) {
        return null;
      }
      return { image: picture.image, fit: "fill", replaceable: true };
    };
  }, [contentRevisions, saved]);

  const onPanePictureCaptured = useCallback<OnirigiriPanePictureCaptureListener>((pane, image) => {
    const content = contentRevisionsRef.current.get(pane.paneId);
    if (!content) return;
    void savePanePicture({
      paneId: pane.paneId,
      revision: `${content}|${viewportRevision()}`,
      image,
      savedAt: Date.now(),
    }).catch(() => {});
  }, []);

  return { getPanePicture, onPanePictureCaptured };
}
