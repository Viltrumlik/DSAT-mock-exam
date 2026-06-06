"use client";
import { useEffect, useRef, useState } from "react";
import { FloatingPanel } from "../FloatingPanel";
import { ScientificCalculator } from "./ScientificCalculator";
import { loadDesmos, type DesmosInstance } from "./loadDesmos";

interface DesmosCalculatorProps {
  onClose: () => void;
}

/**
 * The real Desmos Graphing Calculator (as used on the digital SAT), embedded in
 * a draggable panel. Falls back to the built-in scientific calculator if the
 * Desmos script can't load (offline / blocked by CSP). UI-only; no exam coupling.
 */
export function DesmosCalculator({ onClose }: DesmosCalculatorProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<DesmosInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDesmos().then((factory) => {
      if (cancelled) return;
      if (!factory || !mountRef.current) {
        setStatus("error");
        return;
      }
      instanceRef.current = factory.GraphingCalculator(mountRef.current, {
        expressions: true,
        settingsMenu: false,
        zoomButtons: true,
        border: false,
      });
      setStatus("ready");
    });
    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  return (
    <FloatingPanel title="Calculator" onClose={onClose} initial={{ x: 120, y: 80, w: 560, h: 620 }} minW={360} minH={420}>
      {status === "error" ? (
        <ScientificCalculator />
      ) : (
        <div className="relative h-full w-full">
          <div ref={mountRef} className="h-full w-full" />
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
            </div>
          )}
        </div>
      )}
    </FloatingPanel>
  );
}
