"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Thin wrapper over the Fullscreen API. Self-contained — no exam coupling.
 * Tracks state via the `fullscreenchange` event so the UI stays in sync even
 * when the user exits with Esc.
 */
export function useFullscreen(target?: () => Element | null) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enter = useCallback(async () => {
    const el = target?.() ?? document.documentElement;
    try {
      await el.requestFullscreen?.();
    } catch {
      /* user denied / unsupported */
    }
  }, [target]);

  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void exit();
    else void enter();
  }, [enter, exit]);

  return { isFullscreen, enter, exit, toggle, supported: typeof document !== "undefined" && Boolean(document.documentElement.requestFullscreen) };
}
