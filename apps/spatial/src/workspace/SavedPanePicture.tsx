import { useEffect, useRef, type ReactNode } from "react";

/** A saved picture of a thread pane, filling the pane, with its summary for assistive technology. */
export function SavedPanePicture({ image, summary }: { image: Blob; summary: ReactNode }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const url = URL.createObjectURL(image);
    element.src = url;
    return () => URL.revokeObjectURL(url);
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
