/**
 * A tiny async-resource hook: load once, expose {data, loading, error, refetch}, optionally
 * poll. Keeps the native app free of a data-fetching library for its two read queries.
 *
 * Importer: screens/YourTests.tsx. No server contract here.
 *
 * A refetch (manual or polled) does NOT flip `loading` back on once data is in hand, so a
 * background poll never blanks the screen; a failed refetch keeps the last data and sets `error`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useResource<T>(fn: () => Promise<T>, opts: { enabled?: boolean; intervalMs?: number } = {}): Resource<T> {
  const { enabled = true, intervalMs } = opts;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const dataRef = useRef<T | null>(null);

  const load = useCallback(async () => {
    if (dataRef.current == null) setLoading(true);
    setError(null);
    try {
      const next = await fnRef.current();
      dataRef.current = next;
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    if (!intervalMs) return;
    const t = setInterval(() => void load(), intervalMs);
    return () => clearInterval(t);
  }, [enabled, intervalMs, load]);

  return { data, loading, error, refetch: () => void load() };
}
