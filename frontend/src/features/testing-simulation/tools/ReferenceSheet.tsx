"use client";
import { FloatingPanel } from "./FloatingPanel";

interface ReferenceSheetProps {
  onClose: () => void;
}

/** Static SAT Math reference figures/formulas. Content only — no exam coupling. */
const FORMULAS: Array<{ label: string; body: string }> = [
  { label: "Circle area", body: "A = πr²" },
  { label: "Circle circumference", body: "C = 2πr" },
  { label: "Rectangle area", body: "A = ℓw" },
  { label: "Triangle area", body: "A = ½bh" },
  { label: "Pythagorean", body: "a² + b² = c²" },
  { label: "Special right 30-60-90", body: "x, x√3, 2x" },
  { label: "Special right 45-45-90", body: "s, s, s√2" },
  { label: "Rectangular solid volume", body: "V = ℓwh" },
  { label: "Cylinder volume", body: "V = πr²h" },
  { label: "Sphere volume", body: "V = 4⁄3 πr³" },
  { label: "Cone volume", body: "V = 1⁄3 πr²h" },
  { label: "Pyramid volume", body: "V = 1⁄3 ℓwh" },
];

export function ReferenceSheet({ onClose }: ReferenceSheetProps) {
  return (
    <FloatingPanel title="Reference Sheet" onClose={onClose} initial={{ x: 200, y: 110, w: 380, h: 520 }} minW={300} minH={300}>
      <div className="p-4">
        <p className="mb-3 text-xs font-semibold text-slate-500">
          The number of degrees of arc in a circle is 360. The number of radians of arc in a circle is 2π. The sum of the
          measures in degrees of the angles of a triangle is 180.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {FORMULAS.map((f) => (
            <div key={f.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{f.label}</div>
              <div className="mt-1 font-[Georgia] text-lg font-bold text-slate-900">{f.body}</div>
            </div>
          ))}
        </div>
      </div>
    </FloatingPanel>
  );
}
