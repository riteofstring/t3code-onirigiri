import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function SavedPanePicture({
  image,
  cssSize,
  preparedUrl,
  pictureUrl,
  summary,
  fadeIn = false,
  mayFade,
  onFadeIn,
}: {
  image: Blob;
  cssSize: { readonly width: number; readonly height: number };
  preparedUrl: string | null;
  pictureUrl: (image: Blob) => string;
  summary: ReactNode;
  fadeIn?: boolean;
  /** Asked when the picture first shows; false shows it at once. Fades belong to rest, not motion. */
  mayFade?: (() => boolean) | undefined;
  onFadeIn?: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const { width, height } = cssSize;
  const [shown, setShown] = useState(() =>
    preparedUrl ? { url: preparedUrl, width, height } : null,
  );
  const [fading, setFading] = useState(fadeIn);
  useEffect(() => {
    if (fading && shown) onFadeIn?.();
  }, [fading, onFadeIn, shown]);
  // Decided before the picture's first paint, so one that may not fade never starts to. A picture
  // that arrives while the camera moves has its animation off, and no event would end the fade.
  useLayoutEffect(() => {
    if (!fading || !shown) return;
    if (mayFade?.() === false || ref.current?.closest("[data-spatial-camera-moving]"))
      setFading(false);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- asked once, when the picture first shows
  }, [fading, shown]);
  useEffect(() => {
    const element = ref.current;
    if (!fading || !shown || !element) return;
    const end = () => setFading(false);
    element.addEventListener("animationend", end);
    element.addEventListener("animationcancel", end);
    return () => {
      element.removeEventListener("animationend", end);
      element.removeEventListener("animationcancel", end);
    };
  }, [fading, shown]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const url = preparedUrl ?? pictureUrl(image);
    if (shown?.url === url && shown.width === width && shown.height === height) return;
    const next = element.ownerDocument.createElement("img");
    let cancelled = false;
    next.src = url;
    void next.decode().then(
      () => {
        if (cancelled) return;
        setShown({ url, width, height });
      },
      () => {
        if (cancelled) return;
        setShown((current) =>
          current?.width === width && current.height === height ? current : null,
        );
      },
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
        className={`pointer-events-none absolute top-0 left-0 block select-none${fading && shown ? " z-1 spatial-pane-picture-in" : ""}`}
        style={{
          width: shown?.width ?? width,
          height: shown?.height ?? height,
          maxWidth: "none",
          maxHeight: "none",
          visibility: shown ? undefined : "hidden",
        }}
      />
      <div className={shown && !fading ? "sr-only" : "contents"}>{summary}</div>
    </>
  );
}
