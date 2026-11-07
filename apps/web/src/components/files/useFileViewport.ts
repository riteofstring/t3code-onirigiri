import { VirtualizedFile, type File, type PostRenderPhase } from "@pierre/diffs";
import { useEffect, useState } from "react";

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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the virtualized file's container to rerender it when it scrolls into the editor viewport
  useEffect(() => {
    if (!file) return;
    const { container, instance } = file;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) instance.rerender();
      },
      { root: instance.getEditorViewport() ?? null },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [file]);

  const postRender: FilePostRender = (container, instance, phase) => {
    if (phase !== "unmount" && instance instanceof VirtualizedFile) {
      setFile((current) => (current?.instance === instance ? current : { container, instance }));
    }
    onPostRender?.(container, instance, phase);
  };
  return postRender;
}
