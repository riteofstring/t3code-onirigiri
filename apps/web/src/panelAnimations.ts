import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type PanelAnimationDurationMs } from "@t3tools/contracts/settings";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";

interface PanelAnimationSuppressionScope {
  readonly get: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly set: (suppressed: boolean) => void;
}

function createSuppressionScope(initial: boolean): PanelAnimationSuppressionScope {
  let suppressed = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => suppressed,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (next === suppressed) return;
      suppressed = next;
      for (const listener of listeners) listener();
    },
  };
}

const PanelAnimationScopeContext = createContext(createSuppressionScope(false));

export function PanelAnimationSuppressionProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  // Navigation toggles suppression twice. A stable scope notifies its few panel consumers
  // instead of making React search every retained pane below it for context readers.
  const [scope] = useState(() => createSuppressionScope(value));
  useLayoutEffect(() => scope.set(value), [scope, value]);
  return createElement(PanelAnimationScopeContext, { value: scope }, children);
}

/**
 * Suppresses panel motion for the first painted frame of an initial route or navigation.
 * State restored by a route must be visible immediately; later user actions can animate.
 */
export function usePanelNavigationSuppression(navigationKey: string): boolean {
  const [paintedNavigationKey, setPaintedNavigationKey] = useState<string | null>(null);
  const suppressed = paintedNavigationKey !== navigationKey;

  useEffect(() => {
    if (!suppressed) return;
    let releaseFrame = 0;
    const paintFrame = window.requestAnimationFrame(() => {
      releaseFrame = window.requestAnimationFrame(() => setPaintedNavigationKey(navigationKey));
    });
    return () => {
      window.cancelAnimationFrame(paintFrame);
      window.cancelAnimationFrame(releaseFrame);
    };
  }, [navigationKey, suppressed]);

  return suppressed;
}

export function usePanelAnimationSettings(): {
  active: boolean;
  durationMs: PanelAnimationDurationMs;
} {
  const durationMs = useClientSettings((settings) => settings.panelAnimationDurationMs);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const scope = useContext(PanelAnimationScopeContext);
  const [suppressed, setSuppressed] = useState(scope.get);
  // Subscribe during layout: a consumer mounted by the navigation that suppresses it must
  // hear the provider's layout-phase update before the first paint.
  useLayoutEffect(() => {
    setSuppressed(scope.get());
    return scope.subscribe(() => setSuppressed(scope.get()));
  }, [scope]);
  return { active: durationMs > 0 && !prefersReducedMotion && !suppressed, durationMs };
}

/** Keeps closing panel content mounted until its opt-in transition ends. */
export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
  durationMs: PanelAnimationDurationMs,
): { present: boolean; value: T | null } {
  const [present, setPresent] = useState(open);
  const retainedRef = useRef<{ scopeKey: string | null; value: T | null } | null>(
    open ? { scopeKey, value } : null,
  );

  useEffect(() => {
    if (open) retainedRef.current = { scopeKey, value };
  }, [open, scopeKey, value]);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!animated) {
      setPresent(false);
      return;
    }

    const timeout = window.setTimeout(() => setPresent(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [animated, durationMs, open]);

  const retainedValue =
    retainedRef.current?.scopeKey === scopeKey ? retainedRef.current.value : null;
  const visible = open || (animated && present && retainedRef.current?.scopeKey === scopeKey);
  return { present: visible, value: open ? value : visible ? retainedValue : null };
}
