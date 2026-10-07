import { useEffect, useState } from "react";

/**
 * Whether `at` (epoch milliseconds) has passed. An instant already past when
 * the hook first sees it reads as reached at once; a future one re-renders
 * once when it arrives rather than on a recurring clock. Null never passes.
 */
export function useInstantReached(at: number | null): boolean {
  const [reachedAt, setReachedAt] = useState<number | null>(() =>
    at !== null && Date.now() >= at ? at : null,
  );
  useEffect(() => {
    if (at === null) return;
    const timer = setTimeout(() => setReachedAt(at), Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [at]);
  return at !== null && reachedAt === at;
}
