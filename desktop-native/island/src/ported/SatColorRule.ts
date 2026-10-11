// Port of frontend/src/features/testing-simulation/components/SatColorRule.tsx.
// The multi-colour dashed rule under the question header band. Decorative only.
import { h } from "./dom";

export const SAT_RULE_BACKGROUND =
  "repeating-linear-gradient(to right, #b91c1c 0, #b91c1c 48px, transparent 48px, transparent 54px, #ca8a04 54px, #ca8a04 102px, transparent 102px, transparent 108px, #15803d 108px, #15803d 156px, transparent 156px, transparent 162px, #0f172a 162px, #0f172a 210px, transparent 210px, transparent 216px)";

export function SatColorRule(className = ""): HTMLDivElement {
  return h("div", {
    className: `h-[3px] w-full shrink-0 ${className}`,
    attrs: { "aria-hidden": "true" },
    style: { background: SAT_RULE_BACKGROUND },
  });
}
