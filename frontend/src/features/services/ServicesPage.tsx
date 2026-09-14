"use client";

/**
 * /services — the things the learning center does for a student that are not lessons.
 *
 * Three cards, and they are deliberately not the same kind of thing:
 *
 *   Support booking    an existing page, opened
 *   Register for SAT   a dialog that ends by handing the student to a person
 *   College admission  not built yet, and said so plainly
 *
 * **Support moved in here rather than being rebuilt here.** The booking calendar is a real
 * screen with its own state, and inlining it would make this page long and make Services mean
 * "support, plus two other things". The `/support` route also stays exactly where it was —
 * the support-invite notification links to it, and a URL that a message in somebody's inbox
 * points at is not a URL to move.
 *
 * **"Coming soon" is a promise, so it is worded as one and not as a broken link.** A card
 * that looks clickable and does nothing teaches students the app is unreliable; this one does
 * not pretend to be a button, and it is the one card that does not lift.
 *
 * Dressed in the house's white quartz (the owner, 2026-09-13: "u ham austere bo'lib qolgan").
 * The three cards were one shape repeated — the same blue square on the same white card — so
 * each service has a colour and glyph of its own now, and the two that open something say what
 * they open onto: the student's next support hour, and the soonest SAT date on offer.
 */

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  GraduationCap,
  Hourglass,
  LifeBuoy,
  PencilLine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { HeroPage, Skeleton } from "@/components/ui";
import { useMySupportBookings } from "@/features/support/supportHooks";
import { cn } from "@/lib/cn";

import { RegisterForSatDialog } from "./RegisterForSatDialog";
import {
  earliestExamDate,
  formatExamDate,
  nextSupportHour,
  supportHourLabel,
  useExamDates,
} from "./servicesHooks";

type Tone = "emerald" | "primary" | "violet";

/** Every value is a token, so the palette follows the light/dark toggle without a second table. */
const TONE: Record<Tone, { icon: string; edge: string; text: string; pill: string; well: string }> = {
  emerald: {
    icon: "bg-success/15 text-success-foreground",
    edge: "from-success via-success/40 to-transparent",
    text: "text-success-foreground",
    pill: "bg-success/15 text-success-foreground",
    well: "bg-success/[0.08]",
  },
  primary: {
    icon: "bg-primary/15 text-primary dark:text-primary-hover",
    edge: "from-primary via-primary/40 to-transparent",
    text: "text-primary dark:text-primary-hover",
    pill: "bg-primary/15 text-primary dark:text-primary-hover",
    well: "bg-primary/[0.07]",
  },
  // `--chart-6` has no `-soft` companion, so violet mixes its own tints.
  violet: {
    icon: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)] text-[var(--chart-6)]",
    edge: "from-[var(--chart-6)] via-[color-mix(in_oklab,var(--chart-6)_40%,transparent)] to-transparent",
    text: "text-[var(--chart-6)]",
    pill: "bg-[color-mix(in_oklab,var(--chart-6)_14%,transparent)] text-[var(--chart-6)]",
    well: "bg-[color-mix(in_oklab,var(--chart-6)_8%,transparent)]",
  },
};

/**
 * The action pill. Its `::after` spreads the click over the whole card: a card that lifts under
 * the pointer has to take the click it promises, not just a pill in its corner.
 */
function ctaClass(tone: Tone) {
  return cn(
    "ds-ring inline-flex w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 font-[inherit] text-[13px] font-bold no-underline",
    "after:absolute after:inset-0 after:content-['']",
    TONE[tone].pill,
  );
}

function ServiceCard({
  index,
  tone,
  icon: Icon,
  title,
  description,
  fact,
  action,
  opens,
}: {
  index: number;
  tone: Tone;
  icon: LucideIcon;
  title: string;
  description: string;
  fact?: React.ReactNode;
  action: React.ReactNode;
  /** Does the card open something? Only then does it lift under the pointer. */
  opens: boolean;
}) {
  const t = TONE[tone];
  return (
    // cr-cardrise, not cr-pop: it fills `backwards`, so it doesn't pin `transform` and the
    // float's lift still works once the entrance has played.
    <article
      className={cn(
        "quartz squircle cr-cardrise group relative flex h-full flex-col gap-4 overflow-hidden p-5 [--sq:13px]",
        opens && "quartz-float",
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {/* The accent edge — what tells the three apart at a glance. */}
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", t.edge)} />
      <span
        className={cn(
          "squircle flex h-12 w-12 items-center justify-center [--sq:7.5px]",
          t.icon,
          opens &&
            "transition-transform duration-200 ease-[var(--ds-ease-premium)] group-hover:-rotate-3 group-hover:scale-105",
        )}
      >
        <Icon className="h-[22px] w-[22px]" aria-hidden />
      </span>
      <div className="flex-1">
        <h2 className="text-[17px] font-extrabold tracking-[-0.01em] text-foreground">{title}</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {fact}
      {action}
    </article>
  );
}

/** One fact about the service, in a well of the card's own tint — never the kit grey. */
function Fact({
  tone,
  icon: Icon,
  label,
  sub,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  label: string;
  /** A quieter second line — who, where. Its own line, so the first never breaks mid-phrase. */
  sub?: string;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("squircle flex items-center gap-3 px-3.5 py-2.5 [--sq:8px]", t.well)}>
      <Icon className={cn("h-[18px] w-[18px] shrink-0", t.text)} aria-hidden />
      <div className="min-w-0">
        <p className={cn("text-[10.5px] font-extrabold uppercase tracking-[0.08em]", t.text)}>{label}</p>
        <p className="mt-0.5 text-[13px] font-bold leading-snug text-foreground">{children}</p>
        {sub ? <p className="truncate text-[12px] font-medium text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
}

/** Holds the fact's place while it loads, so the card doesn't grow under the student's eye. */
function FactSkeleton() {
  return <Skeleton className="squircle h-[54px] w-full [--sq:8px]" />;
}

export function ServicesPage() {
  const [registering, setRegistering] = useState(false);
  const bookings = useMySupportBookings();
  const dates = useExamDates();

  const nextHour = nextSupportHour(bookings.data);
  const nextDate = earliestExamDate(dates.data);

  // A failed request makes no claim either way: "Nothing booked yet" is only said once the
  // bookings have actually loaded, and a missing date list is not "none on offer".
  const supportFact = bookings.isPending ? (
    <FactSkeleton />
  ) : bookings.isSuccess ? (
    <Fact
      tone="emerald"
      icon={CalendarClock}
      label="Your next hour"
      sub={nextHour ? `with ${nextHour.slot.support_teacher}` : undefined}
    >
      {nextHour ? supportHourLabel(nextHour.slot.starts_at) : "Nothing booked yet"}
    </Fact>
  ) : null;

  const registerFact = dates.isPending ? (
    <FactSkeleton />
  ) : dates.isSuccess ? (
    <Fact tone="primary" icon={CalendarDays} label="Next test date">
      {nextDate ? formatExamDate(nextDate) : "None open just now"}
    </Fact>
  ) : null;

  return (
    <HeroPage className="flex flex-col gap-7">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      {/* cr-cardrise, not a float: nothing on the hero is clickable, so it must not lift. */}
      <section className="quartz squircle cr-cardrise relative overflow-hidden [--sq:15px]">
        {/* The three services' colours as one thin edge, in the order of the cards below. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-success via-primary to-[var(--chart-6)]"
        />
        <div className="relative flex items-start gap-4 px-6 py-7 sm:px-8">
          <span className="squircle flex h-14 w-14 shrink-0 items-center justify-center bg-primary/10 text-primary [--sq:8.5px] dark:text-primary-hover">
            {/* The sidebar's own Services glyph, so the page and the menu item that opens it
                wear the same mark — as the shop's hero wears the shop's bag. */}
            <LifeBuoy className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]">
              Services
            </h1>
            <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
              Booking a teacher, registering for the exam, and getting into university.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ServiceCard
          index={0}
          tone="emerald"
          icon={LifeBuoy}
          title="Support booking"
          description="Book an hour with a support teacher, or bring a classmate into one you already have."
          opens
          fact={supportFact}
          action={
            <Link href="/support" className={ctaClass("emerald")}>
              Open the calendar
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          }
        />

        <ServiceCard
          index={1}
          tone="primary"
          icon={PencilLine}
          title="Register for the SAT"
          description="What you need ready before you register, and the registrar who finishes it with you."
          opens
          fact={registerFact}
          action={
            <button type="button" onClick={() => setRegistering(true)} className={ctaClass("primary")}>
              See what you need
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
          }
        />

        <ServiceCard
          index={2}
          tone="violet"
          icon={GraduationCap}
          title="College admission"
          description="Help with applications, essays and deadlines. We're building this now."
          opens={false}
          action={
            <span
              className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold",
                TONE.violet.pill,
              )}
            >
              <Hourglass className="h-3.5 w-3.5" aria-hidden />
              Coming soon
            </span>
          }
        />
      </div>

      <RegisterForSatDialog open={registering} onClose={() => setRegistering(false)} />
    </HeroPage>
  );
}
