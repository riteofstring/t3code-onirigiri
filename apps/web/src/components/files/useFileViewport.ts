import { VirtualizedFile, type File, type PostRenderPhase } from "@pierre/diffs";
import { useCallback, useEffect, useState } from "react";

export type FilePostRender = <LAnnotation>(
  container: HTMLElement,
  instance: File<LAnnotation, undefined>,
  phase: PostRenderPhase,
) => void;

export function useFileViewport(onPostRender?: FilePostRender): FilePostRender {
  const [file, setFile] = useState<{
    container: HTMLElement;
    instance: Pick<VirtualizedFile, "rerender" | "getEditorViewport">;
  }>();

  useEffect(() => {
    if (!file) return;
    const { container, instance } = file;
    // Pierre retains the old render range after replacing hidden code with a placeholder.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) instance.rerender();
      },
      { root: instance.getEditorViewport() ?? null },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [file]);

  return useCallback<FilePostRender>(
    (container, instance, phase) => {
      if (phase !== "unmount" && instance instanceof VirtualizedFile) {
        setFile((current) => (current?.instance === instance ? current : { container, instance }));
      }
      onPostRender?.(container, instance, phase);
    },
    [onPostRender],
  );
}
