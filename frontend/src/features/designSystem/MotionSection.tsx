"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";

type Tile = { key: string; title: string; spec: string; demo: () => ReactNode };

const stage = "relative grid h-[150px] place-items-center overflow-hidden rounded-[16px] bg-ms-bg";
const toast =
  "flex w-[260px] items-center gap-3 rounded-[16px] bg-ms-inverse-bg py-2 pl-4 pr-2 text-[14px] font-medium text-ms-inverse-fg shadow-ms-2";

const TILES: Tile[] = [
  {
    key: "press",
    title: "Press",
    spec: "ms-press · scale .97 · 100 ms",
    demo: () => (
      <button type="button" className="ms-press inline-flex h-12 items-center gap-2 rounded-ms-btn bg-ms-primary px-5 text-[15px] font-semibold text-white hover:bg-ms-primary-hover">
        <Icon name="ms-paid" />
        Record payment
      </button>
    ),
  },
  {
    key: "fade-in",
    title: "Appear",
    spec: "animate-ms-fade-in · 160 ms",
    demo: () => (
      <span className="animate-ms-fade-in inline-flex items-center gap-2 rounded-ms-chip bg-ms-positive-soft px-3 py-2 font-semibold text-ms-positive-fg">
        <Icon name="check" />
        Saved
      </span>
    ),
  },
  {
    key: "fade-out",
    title: "Leave",
    spec: "animate-ms-fade-out · 120 ms ease-in",
    demo: () => (
      <span className="animate-ms-fade-out inline-flex items-center gap-2 rounded-ms-chip bg-ms-surface-2 px-3 py-2 font-medium text-ms-fg">
        Dismissed
      </span>
    ),
  },
  {
    key: "check-draw",
    title: "Done — check draws",
    spec: "animate-ms-check-draw · 320 ms",
    demo: () => (
      <svg width="64" height="64" viewBox="0 0 24 24" aria-hidden="true" className="text-ms-positive">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".25" />
        <path className="animate-ms-check-draw" d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "shake",
    title: "Wrong — small shake",
    spec: "animate-ms-shake · 280 ms · on submit only",
    demo: () => (
      <div className="flex w-[230px] flex-col gap-2">
        <div className="animate-ms-shake flex h-11 items-center gap-2 rounded-ms-ctl border border-ms-critical bg-ms-card px-3 text-[15px] text-ms-fg">
          <span className="text-ms-fg-3">+998</span>
          <span className="tabular-nums">90 153 85</span>
        </div>
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-ms-critical-fg">
          <Icon name="alert" size="sm" />2 digits missing
        </span>
      </div>
    ),
  },
  {
    key: "celebration",
    title: "Small celebration",
    spec: "animate-ms-burst + check-pop · 600 ms · a whole job done",
    demo: () => (
      <div className="relative grid size-16 place-items-center">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
          <span key={angle} className="absolute inset-0 grid place-items-center" style={{ rotate: `${angle}deg` }}>
            <span
              className={`animate-ms-burst size-2 rounded-full ${["bg-ms-primary", "bg-ms-positive", "bg-ms-attention"][i % 3]}`}
            />
          </span>
        ))}
        <span className="animate-ms-check-pop grid size-14 place-items-center rounded-full bg-ms-positive text-white">
          <Icon name="check" size="xl" />
        </span>
      </div>
    ),
  },
  {
    key: "pop",
    title: "Attendance tap",
    spec: "animate-ms-pop · 1.12 · 200 ms",
    demo: () => (
      <div className="flex gap-2">
        <span className="animate-ms-pop inline-flex h-10 items-center gap-1.5 rounded-ms-chip bg-ms-positive px-3.5 text-[14px] font-semibold text-white">
          <Icon name="ms-present" />Present
        </span>
        <span className="inline-flex h-10 items-center gap-1.5 rounded-ms-chip bg-ms-surface-2 px-3.5 text-[14px] text-ms-fg">
          <Icon name="ms-late" />Late
        </span>
      </div>
    ),
  },
  {
    key: "roll",
    title: "Number rolls",
    spec: "animate-ms-roll-out / roll-in · 240 ms",
    demo: () => (
      <div className="flex w-[220px] flex-col gap-1 rounded-ms-card bg-ms-card px-4 py-3 shadow-ms-1">
        <span className="text-ms-small text-ms-fg-3">Owes</span>
        <span className="relative block h-[30px] overflow-hidden">
          <span className="animate-ms-roll-out absolute inset-0 text-[22px] font-bold leading-[30px] text-ms-critical-fg">750 000 so&apos;m</span>
          <span className="animate-ms-roll-in absolute inset-0 text-[22px] font-bold leading-[30px] text-ms-positive-fg [animation-delay:400ms]">0 so&apos;m</span>
        </span>
      </div>
    ),
  },
  {
    key: "freeze",
    title: "Freeze",
    spec: "animate-ms-snow-in · 320 ms",
    demo: () => (
      <div className="flex w-[230px] items-center gap-3 rounded-ms-card bg-ms-frozen-soft px-4 py-3">
        <span className="relative grid size-10 place-items-center rounded-full bg-ms-av3-bg text-[15px] font-semibold text-ms-av3-fg">
          BJ
          <span className="animate-ms-snow-in absolute -bottom-0.5 -right-0.5 grid size-[22px] place-items-center rounded-full bg-ms-frozen-soft text-ms-frozen-fg shadow-[0_0_0_2px_var(--ms-card)]">
            <Icon name="snow" size="sm" />
          </span>
        </span>
        <span className="flex flex-col">
          <b className="text-[15px] text-ms-fg">Bekzod Jo&apos;rayev</b>
          <span className="text-ms-small text-ms-frozen-fg">Frozen for debt</span>
        </span>
      </div>
    ),
  },
  {
    key: "ticks",
    title: "Delivery ticks",
    spec: "animate-ms-tick-in · second tick on delivery",
    demo: () => (
      <span className="flex items-center gap-2 rounded-[18px_18px_6px_18px] bg-ms-primary-soft px-3.5 py-2.5 text-[15px] text-ms-fg">
        Mock tomorrow, 15:00
        <span className="flex items-center text-ms-primary-text">
          <Icon name="check" size="sm" />
          <span className="animate-ms-tick-in -ml-2.5 [animation-delay:300ms]">
            <Icon name="check" size="sm" />
          </span>
        </span>
      </span>
    ),
  },
  {
    key: "toast",
    title: "Toast with Undo",
    spec: "animate-ms-rise-in · 240 ms · countdown ring 8 s",
    demo: () => (
      <div className={`animate-ms-rise-in ${toast}`}>
        <Icon name="ms-freeze" />
        <span className="flex-1">Bekzod frozen</span>
        <span className="inline-flex h-9 items-center gap-2 rounded-[8px] px-3 font-semibold text-ms-inverse-link">
          <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity=".3" />
            <circle className="animate-ms-countdown" cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2" transform="rotate(-90 11 11)" />
          </svg>
          Undo
        </span>
      </div>
    ),
  },
  {
    key: "toast-out",
    title: "Toast leaves",
    spec: "animate-ms-sink-out · 120 ms ease-in",
    demo: () => (
      <div className={`animate-ms-sink-out ${toast}`}>
        <Icon name="check" />
        <span className="flex-1">Attendance sent</span>
      </div>
    ),
  },
  {
    key: "sheet-bottom",
    title: "Bottom sheet (phone)",
    spec: "animate-ms-sheet-in-bottom · 280 ms",
    demo: () => (
      <div className="absolute inset-0">
        <div className="animate-ms-scrim-in absolute inset-0 bg-ms-scrim" />
        <div className="animate-ms-sheet-in-bottom absolute inset-x-0 bottom-0 rounded-t-[22px] bg-ms-card px-4 pb-3 pt-2 shadow-ms-3">
          <div className="mx-auto mb-2 h-[5px] w-10 rounded-full bg-ms-surface-3" />
          <div className="flex h-10 items-center gap-2.5 text-[15px] text-ms-fg"><Icon name="key" className="text-ms-fg-2" />One-time password</div>
          <div className="flex h-10 items-center gap-2.5 text-[15px] text-ms-fg"><Icon name="ms-freeze" className="text-ms-fg-2" />Unfreeze</div>
        </div>
      </div>
    ),
  },
  {
    key: "sheet-bottom-out",
    title: "Bottom sheet closes",
    spec: "animate-ms-sheet-out-bottom · 160 ms",
    demo: () => (
      <div className="absolute inset-0">
        <div className="animate-ms-scrim-out absolute inset-0 bg-ms-scrim" />
        <div className="animate-ms-sheet-out-bottom absolute inset-x-0 bottom-0 h-20 rounded-t-[22px] bg-ms-card shadow-ms-3" />
      </div>
    ),
  },
  {
    key: "side-sheet",
    title: "Side sheet (desktop)",
    spec: "animate-ms-sheet-in-right · 280 ms",
    demo: () => (
      <div className="absolute inset-0">
        <div className="animate-ms-scrim-in absolute inset-0 bg-ms-scrim" />
        <div className="animate-ms-sheet-in-right absolute inset-y-0 right-0 flex w-[55%] flex-col gap-2 bg-ms-card p-3 shadow-ms-3">
          <b className="text-[14px] text-ms-fg">Sardor Qodirov</b>
          <span className="text-ms-small text-ms-fg-3">Middle M5 · Math</span>
        </div>
      </div>
    ),
  },
  {
    key: "side-sheet-out",
    title: "Side sheet closes",
    spec: "animate-ms-sheet-out-right · 160 ms",
    demo: () => (
      <div className="absolute inset-0">
        <div className="animate-ms-sheet-out-right absolute inset-y-0 right-0 w-[55%] bg-ms-card shadow-ms-3" />
      </div>
    ),
  },
  {
    key: "dialog",
    title: "Dialog",
    spec: "animate-ms-dialog-in + scrim-in · 240 ms",
    demo: () => (
      <div className="absolute inset-0 grid place-items-center">
        <div className="animate-ms-scrim-in absolute inset-0 bg-ms-scrim" />
        <div className="animate-ms-dialog-in relative w-[70%] rounded-ms-dlg bg-ms-card p-4 shadow-ms-3">
          <b className="text-[15px] text-ms-fg">Send 13 SMS?</b>
          <p className="text-ms-small text-ms-fg-3">Cannot be recalled.</p>
        </div>
      </div>
    ),
  },
  {
    key: "dialog-out",
    title: "Dialog closes",
    spec: "animate-ms-dialog-out + scrim-out · 120 ms",
    demo: () => (
      <div className="absolute inset-0 grid place-items-center">
        <div className="animate-ms-scrim-out absolute inset-0 bg-ms-scrim" />
        <div className="animate-ms-dialog-out relative h-16 w-[70%] rounded-ms-dlg bg-ms-card shadow-ms-3" />
      </div>
    ),
  },
  {
    key: "skeleton",
    title: "Skeleton",
    spec: "animate-ms-shimmer · 1.4 s · same shape as the content",
    demo: () => (
      <div className="flex w-[220px] flex-col gap-2.5 rounded-ms-card bg-ms-card p-4">
        <span className="animate-ms-shimmer h-3.5 w-[70%] rounded-[6px]" />
        <span className="animate-ms-shimmer h-3 w-[45%] rounded-[6px]" />
        <span className="animate-ms-shimmer h-3 w-[60%] rounded-[6px]" />
      </div>
    ),
  },
  {
    key: "flash",
    title: "“You are here” flash",
    spec: "animate-ms-flash · amber wash 1.2 s",
    demo: () => (
      <div className="w-[240px] rounded-ms-card bg-ms-card p-1.5">
        <div className="flex h-11 items-center rounded-[12px] px-3 text-[14px] text-ms-fg">Gulnoza Mirzayeva</div>
        <div className="animate-ms-flash flex h-11 items-center rounded-[12px] px-3 text-[14px] font-semibold text-ms-fg">Bekzod Jo&apos;rayev</div>
        <div className="flex h-11 items-center rounded-[12px] px-3 text-[14px] text-ms-fg">Sardor Qodirov</div>
      </div>
    ),
  },
  {
    key: "spin",
    title: "Working",
    spec: "animate-ms-spin · 1.1 s · always with words",
    demo: () => (
      <span className="flex items-center gap-2.5 text-[15px] font-semibold text-ms-fg">
        <span className="animate-ms-spin inline-flex text-ms-primary-text">
          <Icon name="ms-sync" size="lg" />
        </span>
        Syncing with lc-up…
      </span>
    ),
  },
  {
    key: "pulse",
    title: "Live",
    spec: "animate-ms-pulse · 1.8 s · only while live",
    demo: () => (
      <span className="inline-flex h-7 items-center gap-2.5 rounded-full bg-ms-positive-soft px-3 text-[14px] font-semibold text-ms-positive-fg">
        <span className="relative size-2">
          <span className="absolute inset-0 rounded-full bg-current" />
          <span className="animate-ms-pulse absolute inset-0 rounded-full bg-current" />
        </span>
        Lesson now · Middle M5
      </span>
    ),
  },
  {
    key: "ring-turn",
    title: "Next lesson ring",
    spec: "animate-ms-ring-turn · 9 s per turn",
    demo: () => (
      <span className="relative grid size-[84px] place-items-center">
        <svg className="animate-ms-ring-turn absolute inset-0 text-ms-primary" width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r="39" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="18 7" strokeLinecap="round" />
        </svg>
        <span className="grid size-[66px] place-items-center rounded-full bg-ms-av5-bg text-[18px] font-semibold text-ms-av5-fg">M5</span>
      </span>
    ),
  },
  {
    key: "hover-lift",
    title: "Hover lift",
    spec: "ms-hover-lift · −3 px · after an entrance too",
    demo: () => (
      <a
        href="#motion"
        data-testid="lift-probe"
        className="animate-ms-fade-in ms-hover-lift flex w-[210px] items-center gap-3 rounded-ms-card bg-ms-card p-4 text-ms-fg shadow-ms-1"
      >
        <Icon name="ms-fullmock" size="xl" className="text-ms-math" />
        <b className="text-[15px]">Full Mock 5</b>
      </a>
    ),
  },
];

function MotionTile({ tile }: { tile: Tile }) {
  const [run, setRun] = useState(0);
  return (
    <article data-motion={tile.key} className="flex flex-col gap-3 rounded-ms-card bg-ms-card p-3.5 shadow-ms-1">
      <div className={stage}>
        <div key={run} data-demo className="contents">
          {tile.demo()}
        </div>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <b className="text-[15px] text-ms-fg">{tile.title}</b>
          <span className="font-ms-mono text-[12px] text-ms-fg-3">{tile.spec}</span>
        </div>
        <button
          type="button"
          onClick={() => setRun((n) => n + 1)}
          className="ms-press ms-transition h-9 shrink-0 rounded-ms-btn bg-ms-surface-2 px-3 text-[14px] font-semibold text-ms-fg hover:bg-ms-surface-3"
        >
          Replay
        </button>
      </div>
    </article>
  );
}

/** One tile per animation in the Motion board, each replayable; plays once, as in the product. */
export function MotionSection() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <span
        className={`inline-flex h-7 items-center gap-1.5 self-start rounded-full px-3 text-[13px] font-semibold ${
          reduced ? "bg-ms-attention-soft text-ms-attention-fg" : "bg-ms-positive-soft text-ms-positive-fg"
        }`}
      >
        <Icon name={reduced ? "warn" : "check"} size="sm" />
        {reduced ? "Reduced motion is on: every tile shows its end state" : "Full motion"}
      </span>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
        {TILES.map((tile) => (
          <MotionTile key={tile.key} tile={tile} />
        ))}
      </div>
    </div>
  );
}
