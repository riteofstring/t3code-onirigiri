export const BACKGROUND_PICTURE_QUIET_MS = 3000;
export const PICTURE_IDLE_BUDGET_MS = 8;

export function observePicturePressure(onBusy: (finishedAt: number) => void): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};
  const entryTypes = ["longtask", "long-animation-frame"].filter((type) =>
    (PerformanceObserver.supportedEntryTypes ?? []).includes(type),
  );
  if (entryTypes.length === 0) return () => {};
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) onBusy(entry.startTime + entry.duration);
  });
  observer.observe({ entryTypes });
  return () => observer.disconnect();
}
