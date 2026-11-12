import { useEffect, useRef, useState } from "react";

/** What the picture system last did, kept for the on-page readout. */
export const pictureLog = {
  producers: new Map<string, string>(),
  started: 0,
  saved: 0,
  failed: 0,
  last: "none yet",
  arrival: "none yet",
};

/** `?pictureStatus=1` shows the readout for this tab; `?pictureStatus=0` hides it again. */
export const pictureStatusRequested = (() => {
  if (typeof window === "undefined") return false;
  try {
    const requested = new URLSearchParams(window.location.search).get("pictureStatus");
    if (requested !== null) sessionStorage.setItem("onirigiri.pictureStatus", requested);
    return sessionStorage.getItem("onirigiri.pictureStatus") === "1";
  } catch {
    return false;
  }
})();

export function describeElement(element: Element): string {
  const name = typeof element.className === "string" ? element.className.split(" ")[0] : "";
  return `${element.localName}${element.id ? `#${element.id}` : ""}${name ? `.${name}` : ""}${
    element.shadowRoot ? " (shadow root)" : ""
  }`;
}

type Status = Readonly<Record<string, string | number | boolean>>;

/** A plain-text readout of why pictures are or are not being taken in this browser. */
export function PictureStatusPanel({ read }: { read: () => Status }) {
  const [status, setStatus] = useState<Status>({});
  const [gpu, setGpu] = useState("checking");
  const latestRead = useRef(read);
  latestRead.current = read;
  useEffect(() => {
    const timer = setInterval(() => setStatus(latestRead.current()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const request = navigator.gpu?.requestAdapter();
    if (!request) return setGpu("no WebGPU");
    void request.then(
      (adapter) => setGpu(adapter ? adapter.info.vendor || "available" : "no adapter"),
      () => setGpu("request failed"),
    );
  }, []);
  const rows: Status = {
    browser: /Chrom\w*\/[\d.]+/.exec(navigator.userAgent)?.[0] ?? navigator.userAgent,
    "html-in-canvas": "captureElementImage" in HTMLCanvasElement.prototype,
    webgpu: gpu,
    ...status,
    "captures started / saved / failed": `${pictureLog.started} / ${pictureLog.saved} / ${pictureLog.failed}`,
    "last capture": pictureLog.last,
    "focused chat (ms after focus)": pictureLog.arrival,
    "live producers detected": [...new Set(pictureLog.producers.values())].join(", ") || "nothing",
  };
  return (
    <pre
      aria-label="Picture status"
      className="pointer-events-none absolute bottom-14 left-2 z-50 rounded-md border border-border bg-background/90 p-2 font-mono text-2xs leading-4 text-foreground"
    >
      {Object.entries(rows)
        .map(([label, value]) => `${label}: ${String(value)}`)
        .join("\n")}
    </pre>
  );
}
