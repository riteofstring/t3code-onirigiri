import { useEffect, useState } from "react";

/**
 * Whether `at` (epoch milliseconds) has passed. Re-renders once when it is
 * reached rather than on a recurring clock; null never passes.
 */
export function useInstantReached(at: number | null): boolean {
  const [reachedAt, setReachedAt] = useState<number | null>(null);
  useEffect(() => {
    if (at === null) return;
    const timer = setTimeout(() => setReachedAt(at), Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [at]);
  return at !== null && reachedAt === at;
}
