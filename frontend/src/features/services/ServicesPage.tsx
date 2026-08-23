"use client";

/**
 * /services — the things the school does for a student that are not lessons.
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
 * not pretend to be a button.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, GraduationCap, LifeBuoy, PencilLine } from "lucide-react";
import { Badge, Card, HeroPage, PageHeader } from "@/components/ui";
import { RegisterForSatDialog } from "./RegisterForSatDialog";

function ServiceCard({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof LifeBuoy;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col gap-3 p-5">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="flex-1">
        <h2 className="text-base font-extrabold text-foreground">{title}</h2>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{description}</p>
      </div>
      {action}
    </Card>
  );
}

export function ServicesPage() {
  const [registering, setRegistering] = useState(false);

  return (
    <HeroPage>
      <PageHeader
        title="Services"
        description="Booking a teacher, registering for the exam, and getting into university."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ServiceCard
          icon={LifeBuoy}
          title="Support booking"
          description="Book an hour with a support teacher, or bring a classmate into one you already have."
          action={
            <Link
              href="/support"
              className="inline-flex items-center gap-1.5 text-sm font-extrabold text-primary no-underline"
            >
              Open the calendar
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />

        <ServiceCard
          icon={PencilLine}
          title="Register for the SAT"
          description="What you need ready before you register, and the registrar who finishes it with you."
          action={
            <button
              type="button"
              onClick={() => setRegistering(true)}
              className="inline-flex items-center gap-1.5 bg-transparent p-0 text-left text-sm font-extrabold text-primary"
            >
              See what you need
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          }
        />

        <ServiceCard
          icon={GraduationCap}
          title="College admission"
          description="Help with applications, essays and deadlines. We're building this now."
          // `self-start` because the card is a flex column, which stretches its children —
          // without it the badge spans the full card width and reads as a disabled button
          // rather than a status.
          action={<Badge variant="neutral" className="self-start">Coming soon</Badge>}
        />
      </div>

      <RegisterForSatDialog open={registering} onClose={() => setRegistering(false)} />
    </HeroPage>
  );
}
