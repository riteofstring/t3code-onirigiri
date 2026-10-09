import { useEffect, useRef, useState, type ReactNode } from "react";

/** A saved picture of a thread pane, filling the pane, with its summary for assistive technology. */
export function SavedPanePicture({
  image,
  preparedUrl,
  pictureUrl,
  summary,
}: {
  image: Blob;
  preparedUrl: string | null;
  pictureUrl: (image: Blob) => string;
  summary: ReactNode;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [initialUrl] = useState(preparedUrl);
  const shownUrl = useRef(initialUrl);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const url = preparedUrl ?? pictureUrl(image);
    if (shownUrl.current === url) return;
    // Previously warmed pixels may have been discarded; keep the current cover until decoding.
    const next = element.ownerDocument.createElement("img");
    let cancelled = false;
    next.src = url;
    void next.decode().then(
      () => {
        if (cancelled) return;
        element.src = url;
        shownUrl.current = url;
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [image, pictureUrl, preparedUrl]);
  return (
    <>
      <img
        ref={ref}
        src={initialUrl ?? undefined}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 block size-full select-none"
      />
      <div className="sr-only">{summary}</div>
    </>
  );
}
