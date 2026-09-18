"use client";

/**
 * The nearest event, on the dashboard.
 *
 * Styled in the `.dzboard` idiom — inline styles over `--dz-*` tokens — rather than with the
 * shared UI kit, because it sits inside the dashboard and has to belong to it. See the header
 * comment in StudentDashboard.tsx.
 *
 * It hides itself when there is nothing on, and only then: a band of empty card on every
 * student's screen is worse than no band. A FAILED fetch is not an empty list, and says so
 * quietly — this is a noticeboard, not the student's homework.
 */

import { CalendarDays } from "lucide-react";

import { useSignUpForEvent, useUpcomingEvents } from "@/features/events/eventsHooks";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

export function DashboardEvents() {
  const events = useUpcomingEvents();
  const signUp = useSignUpForEvent();

  if (events.isPending) return null;

  if (events.isError) {
    return (
      <div style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-mute)" }}>
          Events didn&apos;t load.{" "}
          <button
            type="button"
            onClick={() => void events.refetch()}
            style={{
              background: "transparent", border: 0, padding: 0, color: "var(--dz-indigo)",
              fontWeight: 700, textDecoration: "underline", cursor: "pointer",
            }}
          >
            Try again
          </button>
        </p>
      </div>
    );
  }

  const next = (events.data ?? [])[0];
  if (!next) return null;

  const holdsSeat = next.my_registration?.status === "REGISTERED";

  return (
    <div
      className="dz-lift"
      style={{
        background: "var(--dz-card)",
        border: "1px solid var(--dz-border)",
        borderRadius: 24,
        padding: "22px 26px",
        marginBottom: 22,
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          width: 42, height: 42, borderRadius: 12, background: "var(--dz-indigo-soft)",
          color: "var(--dz-indigo)", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <CalendarDays size={20} />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>
          {next.title}
        </div>
        <div style={{ fontSize: 13, color: "var(--dz-mute)", fontWeight: 500 }}>
          {fmtWhen(next.starts_at)}
          {next.location ? ` · ${next.location}` : ""}
          {holdsSeat ? " · You're signed up" : next.seats_left > 0 ? ` · ${next.seats_left} seats left` : " · Full"}
        </div>
      </div>

      {next.can_sign_up ? (
        <button
          type="button"
          onClick={() => signUp.mutate(next.id)}
          disabled={signUp.isPending}
          style={{
            background: "var(--dz-indigo)", color: "#fff", border: 0, borderRadius: 14,
            padding: "11px 18px", fontSize: 14, fontWeight: 800, cursor: "pointer",
          }}
        >
          Sign up
        </button>
      ) : null}
    </div>
  );
}
