"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

import { Icon } from "@/components/ui/Icon";
import { contrastRatio } from "./contrast";
import { COLOUR_GROUPS, CONTRAST_PAIRS } from "./tokenList";

const ALL = COLOUR_GROUPS.flatMap((g) => g.names);

function ratioOf(values: Record<string, string>, fg: string, bg: string): number | null {
  const pick = (n: string) => (n.startsWith("#") ? n : values[n]);
  try {
    return pick(fg) && pick(bg) ? contrastRatio(pick(fg), pick(bg), values.card || "#ffffff") : null;
  } catch {
    return null;
  }
}

/** Every colour token as the browser resolves it in the current theme, and the AA pairs, measured live. */
export function TokenSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ref.current) return;
    const style = getComputedStyle(ref.current);
    setValues(Object.fromEntries(ALL.map((n) => [n, style.getPropertyValue(`--ms-${n}`).trim()])));
  }, [resolvedTheme]);

  return (
    <div ref={ref} className="flex flex-col gap-6">
      {COLOUR_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-3">
          <h3 className="text-ms-h text-ms-fg">{group.title}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            {group.names.map((name) => (
              <div key={name} data-swatch className="flex items-center gap-3 rounded-ms-ctl bg-ms-card p-2 shadow-ms-1">
                <span
                  aria-hidden="true"
                  className="h-9 w-11 shrink-0 rounded-[8px] shadow-[inset_0_0_0_1px_rgba(127,127,127,.35)]"
                  style={{ background: `var(--ms-${name})` }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-ms-mono text-[13px] text-ms-fg">--ms-{name}</span>
                  <span className="truncate font-ms-mono text-[12px] text-ms-fg-3">{values[name] || "—"}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <h3 className="text-ms-h text-ms-fg">Contrast, measured in this theme</h3>
        <div className="overflow-x-auto rounded-ms-card bg-ms-card shadow-ms-1">
          <table className="w-full border-separate border-spacing-0 text-[14px]">
            <thead>
              <tr className="text-left text-ms-fg-3">
                <th className="h-11 border-b border-ms-border px-3 font-medium">Text</th>
                <th className="h-11 border-b border-ms-border px-3 font-medium">On</th>
                <th className="h-11 border-b border-ms-border px-3 text-right font-medium">Needs</th>
                <th className="h-11 border-b border-ms-border px-3 text-right font-medium">Measured</th>
              </tr>
            </thead>
            <tbody>
              {CONTRAST_PAIRS.map(([fg, bg, min]) => {
                const ratio = ratioOf(values, fg, bg);
                const ok = ratio !== null && ratio >= min;
                return (
                  <tr key={`${fg}/${bg}`}>
                    <td className="h-10 border-b border-ms-line px-3 font-ms-mono text-ms-fg">{fg}</td>
                    <td className="h-10 border-b border-ms-line px-3 font-ms-mono text-ms-fg-2">{bg}</td>
                    <td className="h-10 border-b border-ms-line px-3 text-right tabular-nums text-ms-fg-2">{min}:1</td>
                    <td className="h-10 border-b border-ms-line px-3 text-right">
                      {ratio === null ? (
                        <span className="text-ms-fg-3">—</span>
                      ) : (
                        <span
                          className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold tabular-nums ${
                            ok ? "bg-ms-positive-soft text-ms-positive-fg" : "bg-ms-critical-soft text-ms-critical-fg"
                          }`}
                        >
                          <Icon name={ok ? "check" : "alert"} size="sm" />
                          {ratio.toFixed(1)}:1 {ok ? "passes" : "fails"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
