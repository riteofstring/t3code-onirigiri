import { vi } from "vite-plus/test";

export function simulatePicturePressure() {
  const callbacks = new Set<PerformanceObserverCallback>();
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      static supportedEntryTypes = ["longtask", "long-animation-frame"];
      constructor(private callback: PerformanceObserverCallback) {}
      observe() {
        callbacks.add(this.callback);
      }
      disconnect() {
        callbacks.delete(this.callback);
      }
    },
  );
  return (entryType = "long-animation-frame") => {
    const entry = { entryType, startTime: performance.now() - 60, duration: 60 };
    for (const callback of callbacks)
      callback(
        { getEntries: () => [entry] } as PerformanceObserverEntryList,
        {} as PerformanceObserver,
      );
  };
}
