import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the suppression into the scope its panel consumers subscribe to, before the navigated frame paints
  useLayoutEffect(() => scope.set(value), [scope, value]);
  return createElement(PanelAnimationScopeContext, { value: scope }, children);
}

export function usePanelNavigationSuppression(navigationKey: string): boolean {
  const [paintedNavigationKey, setPaintedNavigationKey] = useState<string | null>(null);
  const suppressed = paintedNavigationKey !== navigationKey;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Wait two browser frames so the new route paints before panel animations are re-enabled; cancel the frames on change or unmount.
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes during layout to the provider's suppression scope, so a consumer mounted by the suppressing navigation hears its layout-phase update before paint
  useLayoutEffect(() => scope.subscribe(() => setSuppressed(scope.get())), [scope]);
  return { active: durationMs > 0 && !prefersReducedMotion && !suppressed, durationMs };
}

export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
  durationMs: PanelAnimationDurationMs,
): { present: boolean; value: T | null } {
  const [present, setPresent] = useState(open);
  const [retained, setRetained] = useState<{ scopeKey: string | null; value: T | null } | null>(
    open ? { scopeKey, value } : null,
  );
  if (open && (retained?.scopeKey !== scopeKey || retained.value !== value)) {
    setRetained({ scopeKey, value });
  }

  if (open && !present) setPresent(true);
  if (!open && !animated && present) setPresent(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the closing panel mounted for its CSS exit transition, then unmount it; the timer is cleared on reopen or unmount.
  useEffect(() => {
    if (open || !animated) return;
    const timeout = window.setTimeout(() => setPresent(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [animated, durationMs, open]);

  const retainedValue = retained?.scopeKey === scopeKey ? retained.value : null;
  const visible = open || (animated && present && retained?.scopeKey === scopeKey);
  return { present: visible, value: open ? value : visible ? retainedValue : null };
}
