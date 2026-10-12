import { useEffect, useRef, useState, type ReactNode } from "react";

/** A thread picture at its captured CSS size, with its summary for assistive technology. */
export function SavedPanePicture({
  image,
  cssSize,
  preparedUrl,
  pictureUrl,
  summary,
}: {
  image: Blob;
  cssSize: { readonly width: number; readonly height: number };
  preparedUrl: string | null;
  pictureUrl: (image: Blob) => string;
  summary: ReactNode;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const { width, height } = cssSize;
  const [shown, setShown] = useState(() =>
    preparedUrl ? { url: preparedUrl, width, height } : null,
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const url = preparedUrl ?? pictureUrl(image);
    if (shown?.url === url && shown.width === width && shown.height === height) return;
    // Previously warmed pixels may have been discarded; keep the current cover until decoding.
    const next = element.ownerDocument.createElement("img");
    let cancelled = false;
    next.src = url;
    void next.decode().then(
      () => {
        if (cancelled) return;
        setShown({ url, width, height });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [height, image, pictureUrl, preparedUrl, shown, width]);
  return (
    <>
      <img
        ref={ref}
        src={shown?.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute top-0 left-0 block select-none"
        style={{
          width: shown?.width ?? width,
          height: shown?.height ?? height,
          maxWidth: "none",
          maxHeight: "none",
        }}
      />
      <div className="sr-only">{summary}</div>
    </>
  );
}
