import { useEffect, useRef, type ReactNode } from "react";

/** A saved picture of a thread pane, filling the pane, with its summary for assistive technology. */
export function SavedPanePicture({ image, summary }: { image: Blob; summary: ReactNode }) {
  const ref = useRef<HTMLImageElement>(null);
  const shownUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (shownUrl.current) URL.revokeObjectURL(shownUrl.current);
      shownUrl.current = null;
    },
    [],
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const url = URL.createObjectURL(image);
    const next = element.ownerDocument.createElement("img");
    let cancelled = false;
    next.src = url;
    void next.decode().then(
      () => {
        if (cancelled) return;
        const previous = shownUrl.current;
        element.src = url;
        shownUrl.current = url;
        if (previous) URL.revokeObjectURL(previous);
      },
      () => URL.revokeObjectURL(url),
    );
    return () => {
      cancelled = true;
      if (shownUrl.current !== url) URL.revokeObjectURL(url);
    };
  }, [image]);
  return (
    <>
      <img
        ref={ref}
        alt=""
        draggable={false}
        className="pointer-events-none block size-full select-none"
      />
      <div className="sr-only">{summary}</div>
    </>
  );
}
