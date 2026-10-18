import { useEffect, useState } from "react";

export type FullScreenPhase = "out" | "swap" | "in";

export const FULL_SCREEN_FADE_OUT_MS = 120;
export const FULL_SCREEN_SETTLE_MS = 320;

interface FullScreenTransition {
  requested: boolean;
  fullScreen: boolean;
  phase: FullScreenPhase | null;
}

export function useFullScreenTransition(requested: boolean, animate: boolean) {
  const [state, setState] = useState<FullScreenTransition>({
    requested,
    fullScreen: requested,
    phase: null,
  });
  if (state.requested !== requested) {
    const motion = animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    setState({
      requested,
      fullScreen: motion ? state.fullScreen : requested,
      phase: !motion
        ? null
        : requested !== state.fullScreen
          ? "out"
          : state.phase === "out"
            ? "in"
            : state.phase,
    });
  }
  const { fullScreen, phase } = state;

  useEffect(() => {
    if (phase === "out") {
      const timer = setTimeout(
        () => setState((current) => ({ ...current, fullScreen: current.requested, phase: "swap" })),
        FULL_SCREEN_FADE_OUT_MS,
      );
      return () => clearTimeout(timer);
    }
    if (phase === "swap") {
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setState((current) => ({ ...current, phase: "in" })));
      });
      return () => cancelAnimationFrame(frame);
    }
    if (phase === "in") {
      const timer = setTimeout(
        () => setState((current) => ({ ...current, phase: null })),
        FULL_SCREEN_SETTLE_MS,
      );
      return () => clearTimeout(timer);
    }
  }, [phase]);

  return { requested, fullScreen, phase };
}
