import { useEffect, useRef } from "react";

/** A saved picture of a thread pane, filling the pane. */
export function SavedPanePicture({ image }: { image: Blob }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const url = URL.createObjectURL(image);
    element.src = url;
    return () => URL.revokeObjectURL(url);
  }, [image]);
  return (
    <img
      ref={ref}
      alt=""
      draggable={false}
      className="pointer-events-none block size-full select-none"
    />
  );
}
