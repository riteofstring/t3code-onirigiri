import { VirtualizedFile, type FileOptions } from "@pierre/diffs";
import { useCallback, useEffect, useState } from "react";

type FilePostRender = NonNullable<FileOptions<unknown>["onPostRender"]>;

export function useFileViewport(onPostRender?: FilePostRender): FilePostRender {
  const [file, setFile] = useState<{
    container: HTMLElement;
    instance: Parameters<FilePostRender>[1];
  }>();

  useEffect(() => {
    if (!file || !(file.instance instanceof VirtualizedFile)) return;
    const { container, instance } = file;
    // Pierre retains the old render range after replacing hidden code with a placeholder.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) instance.rerender();
      },
      { root: instance.getScrollContainer() ?? null },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [file]);

  return useCallback<FilePostRender>(
    (container, instance, phase) => {
      if (phase !== "unmount") {
        setFile((current) => (current?.instance === instance ? current : { container, instance }));
      }
      onPostRender?.(container, instance, phase);
    },
    [onPostRender],
  );
}
