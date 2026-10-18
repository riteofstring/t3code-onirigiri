import { useEffect, useState } from "react";

export type FullScreenPhase = "out" | "resize" | "reveal" | "in";

export const FULL_SCREEN_FADE_OUT_MS = 120;
export const FULL_SCREEN_RESIZE_MS = 300;
export const FULL_SCREEN_FADE_IN_MS = 160;

interface FullScreenTransition {
  requested: boolean;
  fullScreen: boolean;
  phase: FullScreenPhase | null;
}

const timedSteps = {
  out: [
    FULL_SCREEN_FADE_OUT_MS,
    (current: FullScreenTransition) => ({
      ...current,
      fullScreen: current.requested,
      phase: "resize" as const,
    }),
  ],
  resize: [
    FULL_SCREEN_RESIZE_MS,
    (current: FullScreenTransition) => ({ ...current, phase: "reveal" as const }),
  ],
  in: [FULL_SCREEN_FADE_IN_MS, (current: FullScreenTransition) => ({ ...current, phase: null })],
} as const;

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
            ? "reveal"
            : state.phase,
    });
  }
  const { fullScreen, phase } = state;

  useEffect(() => {
    if (phase === null) return;
    if (phase === "reveal") {
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setState((current) => ({ ...current, phase: "in" })));
      });
      return () => cancelAnimationFrame(frame);
    }
    const [delay, next] = timedSteps[phase];
    const timer = setTimeout(() => setState(next), delay);
    return () => clearTimeout(timer);
  }, [phase]);

  return { fullScreen, phase };
}
