"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Keys (design handoff v0.3, Controls board · Small parts): shown for the platform in use — ⌘ on a Mac,
 * Ctrl elsewhere. Shortcuts are hints, never the only way.
 */
export function isMacLike(platform: string, userAgent = ""): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform) || /Mac OS X/.test(userAgent);
}

const noop = () => () => {};
function clientMod(): "⌘" | "Ctrl" {
  try {
    const nav = window.navigator as Navigator & { userAgentData?: { platform?: string } };
    return isMacLike(nav.userAgentData?.platform ?? nav.platform ?? "", nav.userAgent) ? "⌘" : "Ctrl";
  } catch {
    return "Ctrl";
  }
}

/** "⌘" on a Mac, "Ctrl" elsewhere; the server renders "Ctrl" and the browser corrects it after hydration. */
export function useModKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(noop, clientMod, () => "Ctrl");
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-ms-border-strong bg-ms-surface px-1.5 font-ms-mono text-[12px] font-medium leading-none text-ms-fg-2 shadow-[0_1px_0_var(--ms-border-strong)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A shortcut as keys: <Shortcut keys={["mod", "K"]} /> → ⌘ K (or Ctrl K). */
export function Shortcut({ keys, className }: { keys: string[]; className?: string }) {
  const mod = useModKey();
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`}>{k === "mod" ? mod : k}</Kbd>
      ))}
    </span>
  );
}
