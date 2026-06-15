"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { FloatingPanel } from "../FloatingPanel";
import { ScientificCalculator } from "./ScientificCalculator";
import { loadDesmos, type DesmosInstance } from "./loadDesmos";

interface DesmosCalculatorProps {
  onClose: () => void;
  /**
   * When true the calculator fills its parent as a docked column (a reserved
   * area beside the question) instead of a floating panel that covers content.
   * See item: Calculator Layout.
   */
  docked?: boolean;
}

/**
 * The real Desmos Graphing Calculator (as used on the digital SAT). Falls back
 * to the built-in scientific calculator if the Desmos script can't load
 * (offline / blocked by CSP). UI-only; no exam coupling.
 *
 * Two presentations share the same Desmos instance logic:
 *   • floating (default) — a draggable FloatingPanel
 *   • docked            — fills its container; the runner reserves the space so
 *                         it never overlaps the passage or answer choices.
 */
export function DesmosCalculator({ onClose, docked = false }: DesmosCalculatorProps) {
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

  const surface =
    status === "error" ? (
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
    );

  if (docked) {
    return (
      <div className="flex h-full w-full flex-col border-r border-slate-200 bg-white">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-sm font-bold text-slate-700">Calculator</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close calculator"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1">{surface}</div>
      </div>
    );
  }

  return (
    <FloatingPanel title="Calculator" onClose={onClose} initial={{ x: 120, y: 80, w: 560, h: 620 }} minW={360} minH={420}>
      {surface}
    </FloatingPanel>
  );
}
