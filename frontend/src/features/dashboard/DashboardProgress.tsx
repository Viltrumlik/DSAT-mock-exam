"use client";

/**
 * Two dashboard sections that answer "where am I?".
 *
 * `LevelCards` — one card per subject the student studies: the level they are on, the level
 * after it, how far through the current one they are, and which week their group is in. Every
 * figure comes from `/api/classes/roadmap/`, which is the same payload the roadmap page draws,
 * so the two screens cannot disagree about a student's progress.
 *
 * `RewardsStrip` — points, XP, coins and strikes in one row.
 *
 * **Nothing here invents a number.** The roadmap returns null for anything it cannot honestly
 * compute — a class with no level set, a level whose journal is not published, a group that
 * has not met yet, journals with no authored duration — and each of those nulls renders as
 * absence or as an em dash rather than as a zero. A dashboard that says "0% complete, week 0,
 * 0 months left" to a student whose school has not finished setting up their course is worse
 * than one that says nothing.
 */

import Link from "next/link";
import { CalendarRange, Coins, Flame, Sparkles, Star, TrendingUp } from "lucide-react";
import { useRoadmap } from "@/features/roadmap/hooks";
import { useMyRewards } from "@/features/rewards/rewardsHooks";
import { useStorefront } from "@/features/shop/shopHooks";

const CARD: React.CSSProperties = {
  background: "var(--dz-card)",
  border: "1px solid var(--dz-border)",
  borderRadius: 24,
  padding: "22px 26px",
};

function Ring({ value }: { value: number }) {
  // A conic-gradient ring rather than an SVG arc: no viewBox maths, and it reads correctly at
  // any size the grid gives it.
  const pct = Math.round(value * 100);
  return (
    <div
      style={{
        width: 62,
        height: 62,
        borderRadius: "50%",
        background: `conic-gradient(var(--dz-indigo) ${pct * 3.6}deg, var(--dz-border) 0deg)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      role="img"
      aria-label={`${pct}% of this level finished`}
    >
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "var(--dz-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 800,
          color: "var(--dz-ink)",
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

export function LevelCards() {
  const roadmap = useRoadmap();

  if (roadmap.isPending) {
    return (
      <div style={{ ...CARD, marginBottom: 22, height: 132, opacity: 0.5 }} aria-hidden />
    );
  }

  // An error must not render as "you study nothing". The student has classes; we failed to
  // read them.
  if (roadmap.isError) {
    return (
      <div style={{ ...CARD, marginBottom: 22 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--dz-ink)" }}>
          Your levels didn&apos;t load.
        </p>
        <button
          type="button"
          onClick={() => void roadmap.refetch()}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            marginTop: 4,
            color: "var(--dz-indigo)",
            fontWeight: 700,
            fontSize: 13,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const tracks = roadmap.data.tracks;
  if (tracks.length === 0) return null;

  const monthsToSat = roadmap.data.months_to_sat;
  const partial =
    monthsToSat !== null && roadmap.data.months_to_sat_basis.length < tracks.length;

  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: tracks.length > 1 ? "1fr 1fr" : "1fr",
          gap: 20,
          marginBottom: monthsToSat !== null ? 14 : 0,
        }}
        className="dz-scoregrid"
      >
        {tracks.map((track) => (
          <div key={track.subject} className="dz-lift" style={CARD}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {track.completion_rate !== null ? (
                <Ring value={track.completion_rate} />
              ) : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: "var(--dz-mute)",
                  }}
                >
                  {track.subject_label}
                </p>
                <p style={{ fontSize: 20, fontWeight: 800, color: "var(--dz-ink)", marginTop: 2 }}>
                  {/* A student whose classroom carries no level is not "Level 0" — the school
                      has not tagged their class yet, and saying so is the honest thing. */}
                  {track.own_level_label ?? "Not set yet"}
                </p>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dz-mute)", marginTop: 3 }}>
                  {track.next_level_label
                    ? `Next: ${track.next_level_label}`
                    : track.own_level_label
                      ? "Top level — nothing above this one"
                      : "Ask your teacher to set your level"}
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 14,
                marginTop: 16,
                paddingTop: 14,
                borderTop: "1px solid var(--dz-border)",
                fontSize: 12.5,
                fontWeight: 700,
                color: "var(--dz-mute)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <CalendarRange size={15} aria-hidden />
                {track.current_week !== null ? `Week ${track.current_week}` : "Week —"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <TrendingUp size={15} aria-hidden />
                {track.total_lessons > 0
                  ? `${track.completed_lessons} of ${track.total_lessons} lessons`
                  : "Lessons coming soon"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Months to the SAT. Sits BESIDE the student's own chosen exam date rather than
          replacing it — that date is when they intend to sit, this is how long their course
          has left, and the two disagreeing is information rather than a bug. */}
      {monthsToSat !== null ? (
        <Link
          href="/roadmap"
          style={{
            ...CARD,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 20px",
            textDecoration: "none",
          }}
        >
          <Sparkles size={18} style={{ color: "var(--dz-indigo)" }} aria-hidden />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--dz-ink)" }}>
            {monthsToSat <= 0
              ? "Your course is finished — you're ready to sit the SAT."
              : `About ${monthsToSat} ${monthsToSat === 1 ? "month" : "months"} of course left before the SAT.`}
            {partial ? (
              <span style={{ color: "var(--dz-mute)", fontWeight: 600 }}>
                {" "}
                Based on {roadmap.data.months_to_sat_basis.join(" and ")} only.
              </span>
            ) : null}
          </span>
        </Link>
      ) : null}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          background: "var(--dz-indigo-soft)",
          color: "var(--dz-indigo)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 18, fontWeight: 800, color: "var(--dz-ink)", lineHeight: 1.1 }}>
          {value}
        </p>
        <p
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: "var(--dz-mute)",
          }}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

export function RewardsStrip() {
  const rewards = useMyRewards();
  // Strikes and the attendance streak live on the storefront payload, not on /rewards/me/ —
  // they are what the strike shop is priced in, so that is where they are computed.
  const shop = useStorefront();

  if (rewards.isPending) {
    return <div style={{ ...CARD, marginBottom: 22, height: 84, opacity: 0.5 }} aria-hidden />;
  }

  if (rewards.isError) {
    return (
      <div style={{ ...CARD, marginBottom: 22 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--dz-ink)" }}>
          Your points didn&apos;t load — they haven&apos;t gone anywhere.
        </p>
        <button
          type="button"
          onClick={() => void rewards.refetch()}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            marginTop: 4,
            color: "var(--dz-indigo)",
            fontWeight: 700,
            fontSize: 13,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/rewards"
      className="dz-lift"
      style={{
        ...CARD,
        marginBottom: 22,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
        gap: 18,
        textDecoration: "none",
      }}
    >
      <Stat icon={<Star size={18} />} label="Points" value={rewards.data.points} />
      <Stat icon={<TrendingUp size={18} />} label="XP" value={rewards.data.xp} />
      <Stat icon={<Coins size={18} />} label="Coins" value={rewards.data.coins} />
      {/* The shop payload is a separate request and may still be in flight or have failed.
          An em dash says "not known yet"; a 0 would say "you have none", which for a streak
          a student has been building is a small lie with a real sting. */}
      <Stat
        icon={<Flame size={18} />}
        label="Strikes"
        value={shop.data ? shop.data.strikes : "—"}
      />
    </Link>
  );
}
