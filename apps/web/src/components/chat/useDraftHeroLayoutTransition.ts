import { useLayoutEffect, useRef } from "react";
import { readLayoutScale } from "./layoutGeometry";

import {
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  DRAFT_HERO_TRANSITION_EASING,
} from "./draftHeroTransition";

export function useDraftHeroLayoutTransition(
  isDraftHeroState: boolean,
  animationsActive: boolean,
  animationDurationMs: number,
) {
  const transitionGroupRef = useRef<HTMLDivElement | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(isDraftHeroState);
  const previousComposerRectRef = useRef<DOMRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const attachTransitionGroupRef = (element: HTMLDivElement | null) => {
    transitionGroupRef.current = element;
  };
  const attachComposerAnchorRef = (element: HTMLDivElement | null) => {
    composerAnchorRef.current = element;
  };
  const captureComposerRect = () => {
    previousComposerRectRef.current = composerAnchorRef.current?.getBoundingClientRect() ?? null;
  };

  useLayoutEffect(() => {
    const transitionGroup = transitionGroupRef.current;
    const composerAnchor = composerAnchorRef.current;
    const nextComposerRect =
      animationsActive && composerAnchor ? composerAnchor.getBoundingClientRect() : null;
    const stateChanged = previousStateRef.current !== isDraftHeroState;
    const mobileComposerTransitionActive =
      typeof document !== "undefined" &&
      document.documentElement.dataset.mobileComposerRouteTransition === "true";

    animationRef.current?.cancel();
    animationRef.current = null;

    const previousComposerRect = previousComposerRectRef.current;
    if (
      stateChanged &&
      animationsActive &&
      !mobileComposerTransitionActive &&
      transitionGroup &&
      composerAnchor &&
      previousComposerRect &&
      nextComposerRect &&
      typeof transitionGroup.animate === "function"
    ) {
      const scale = readLayoutScale(composerAnchor, nextComposerRect);
      const translateX = (previousComposerRect.left - nextComposerRect.left) / scale;
      const translateY = (previousComposerRect.top - nextComposerRect.top) / scale;
      if (Math.abs(translateX) >= 0.5 || Math.abs(translateY) >= 0.5) {
        const animation = transitionGroup.animate(
          [
            { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: animationDurationMs,
            easing: DRAFT_HERO_TRANSITION_EASING,
          },
        );
        animation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
        animationRef.current = animation;
        void animation.finished
          .catch(() => undefined)
          .then(() => {
            if (animationRef.current !== animation) {
              return;
            }
            animationRef.current = null;
          });
      }
    }

    previousStateRef.current = isDraftHeroState;
    previousComposerRectRef.current = nextComposerRect;
  }, [animationDurationMs, animationsActive, isDraftHeroState]);

  return [attachTransitionGroupRef, attachComposerAnchorRef, captureComposerRect] as const;
}
