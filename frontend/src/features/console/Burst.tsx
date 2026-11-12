"use client";

import { useEffect, useState } from "react";

/** The Motion board's colours for the eight dots. */
const DOTS = ["bg-ms-positive", "bg-ms-attention", "bg-ms-info", "bg-ms-primary", "bg-ms-positive", "bg-ms-attention", "bg-ms-info", "bg-ms-primary"];

function tashkentDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
}

/**
 * "Small celebration" (design handoff v0.3, Motion board): eight dots burst once — only for a whole
 * job done, and once per day per job (`id`), so a reload does not throw confetti again. Decoration
 * only: the words beside it carry the news.
 */
export function Burst({ id }: { id: string }) {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const key = `ms-burst:${id}`;
    let seen = "";
    try {
      seen = window.localStorage.getItem(key) ?? "";
    } catch {
      return;
    }
    const today = tashkentDay();
    if (seen === today) return;
    try {
      window.localStorage.setItem(key, today);
    } catch {
      /* no storage: it may burst again tomorrow-ish; harmless */
    }
    setPlay(true);
    const t = window.setTimeout(() => setPlay(false), 900);
    return () => window.clearTimeout(t);
  }, [id]);

  if (!play) return null;
  return (
    <span aria-hidden="true" data-burst className="pointer-events-none absolute left-1/2 top-1/2 size-0">
      {DOTS.map((c, i) => (
        <span key={i} className="absolute left-0 top-0" style={{ rotate: `${i * 45}deg` }}>
          <span className={`animate-ms-burst absolute -left-[3px] -top-[3px] size-1.5 rounded-full ${c}`} style={{ animationDelay: `${(i % 2) * 40}ms` }} />
        </span>
      ))}
    </span>
  );
}
