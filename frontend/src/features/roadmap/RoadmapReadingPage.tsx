"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock,
  FileText,
} from "lucide-react";
import { Alert, HeroPage, PageHero, Skeleton } from "@/components/ui";
import { Button, buttonClassName, Card, EmptyState, ErrorState } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";
import type { RoadmapSection } from "./readingApi";
import { isValidDeliveryId, useMarkRoadmapRead, useRoadmapReading } from "./hooks";

/**
 * A stored passage, as paragraphs.
 *
 * The body is PLAIN TEXT by decision — blank lines separate paragraphs and nothing else is
 * interpreted. Storing HTML would put author-supplied markup on a student's page, and this
 * repo already has a `SafeHtml` component and a written set of rules about the few places
 * that is allowed. A reading page is not a good place to add another entrance.
 */
function Passage({ body }: { body: string }) {
  const paragraphs = useMemo(
    () => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    [body],
  );
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-line text-[15px] leading-relaxed text-foreground">
          {p}
        </p>
      ))}
    </div>
  );
}

/** A video, as an iframe for a link and a player for an uploaded file. */
function Video({ url }: { url: string }) {
  // Only the embeddable hosts get an iframe. Anything else — including an R2 signed URL for
  // an uploaded file — is played by the browser's own <video>, which is also the honest
  // fallback: dropping an arbitrary URL into an iframe is how a page ends up framing
  // something nobody meant to embed.
  const embed = toEmbedUrl(url);
  if (embed) {
    return (
      <div className="relative w-full overflow-hidden rounded-xl border border-border pt-[56.25%]">
        <iframe
          src={embed}
          title="Lesson video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }
  return (
    <video
      controls
      preload="metadata"
      src={url}
      className="w-full rounded-xl border border-border bg-black"
    />
  );
}

/** YouTube and Vimeo watch links → their embed form. Anything else → null. */
function toEmbedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube.com/embed${url.pathname}`;
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = url.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      if (url.pathname.startsWith("/embed/")) return raw;
    }
    if (host === "vimeo.com") return `https://player.vimeo.com/video${url.pathname}`;
    return null;
  } catch {
    return null;
  }
}

function Section({ section }: { section: RoadmapSection }) {
  return (
    <div className="space-y-2.5">
      {section.heading && (
        <h3 className="text-[17px] font-extrabold text-foreground">{section.heading}</h3>
      )}
      {section.kind === "TEXT" && <Passage body={section.body} />}
      {section.kind === "IMAGE" && section.image_url && (
        <figure className="space-y-1.5">
          <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
            {/* `unoptimized`: the bucket is private, so this is a signed URL that expires in
                an hour — Next's optimizer would cache a copy that 403s once it lapses. */}
            <Image
              src={section.image_url}
              alt={section.caption || ""}
              width={1200}
              height={800}
              unoptimized
              className="h-auto w-full object-contain"
            />
          </div>
          {section.caption && (
            <figcaption className="text-[13px] text-muted-foreground">{section.caption}</figcaption>
          )}
        </figure>
      )}
      {section.kind === "VIDEO" && section.video_url && <Video url={section.video_url} />}
    </div>
  );
}

export function RoadmapReadingPage({ deliveryId }: { deliveryId: number }) {
  const reading = useRoadmapReading(deliveryId);
  const markRead = useMarkRoadmapRead(deliveryId);
  const router = useRouter();

  const back = (
    <Link
      href="/roadmap"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the roadmap
    </Link>
  );

  // The invalid-id branch first, and not one of the four: a disabled react-query v5 query
  // reports "pending" forever, so a bad URL would render skeletons that never resolve.
  if (!isValidDeliveryId(deliveryId)) {
    return (
      <HeroPage width="narrow">
        {back}
        <Card className="cr-card mt-4">
          <EmptyState
            icon={BookOpenCheck}
            title="That isn’t a lesson link"
            description="The address is missing a lesson number."
            action={
              <Link href="/roadmap" className={buttonClassName({ variant: "secondary" })}>
                Back to the roadmap
              </Link>
            }
          />
        </Card>
      </HeroPage>
    );
  }

  if (reading.isPending) {
    return (
      <HeroPage width="narrow" className="space-y-5">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </HeroPage>
    );
  }

  if (reading.isError) {
    const status = (reading.error as { response?: { status?: number } })?.response?.status;
    return (
      <HeroPage width="narrow">
        {back}
        <Card className="cr-card mt-4">
          {status === 404 ? (
            <EmptyState
              icon={BookOpenCheck}
              title="Nothing to read here"
              description="This lesson isn’t one of yours, or it hasn’t reached your class yet."
              action={
                <Link href="/roadmap" className={buttonClassName({ variant: "secondary" })}>
                  Back to the roadmap
                </Link>
              }
            />
          ) : (
            // A dropped request is not "no reading". Saying so would send a student away
            // from a page that is sitting there perfectly fine.
            <ErrorState
              title="That didn’t load"
              message="Nothing has been lost — the reading just couldn’t be fetched."
              onRetry={() => void reading.refetch()}
            />
          )}
        </Card>
      </HeroPage>
    );
  }

  const data = reading.data;
  const homeworkHref =
    data.homework_assignment_id != null
      ? `/classes/${data.classroom_id}/assignments/${data.homework_assignment_id}`
      : null;

  return (
    <HeroPage width="narrow" className="space-y-5">
      {back}

      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge={`Lesson ${data.lesson_number}`}
          icon={BookOpenCheck}
          title={data.title}
          description={data.summary || undefined}
          tiles={
            data.estimated_minutes > 0
              ? [{ label: "Reading time", value: `${data.estimated_minutes} min`, icon: Clock }]
              : []
          }
        />
      </Card>

      {data.sections.length === 0 ? (
        <Card className="cr-card">
          <EmptyState
            icon={BookOpenCheck}
            title="Nothing written for this lesson yet"
            description="Your teacher hasn’t added the reading for it. The homework is below if it has been set."
          />
        </Card>
      ) : (
        data.sections.map((section, i) => (
          <Card
            key={section.id}
            className="cr-card space-y-3"
            style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
          >
            <Section section={section} />
          </Card>
        ))
      )}

      {markRead.isError && (
        <Alert tone="danger" title="That didn’t save">
          Your place wasn’t recorded — try the button again.
        </Alert>
      )}

      {/* The bottom of the page: confirm, then the homework. In that order, because the
          homework is the thing the reading was for. */}
      <Card className="cr-card space-y-3">
        {data.read ? (
          <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden /> You’ve read this
          </p>
        ) : data.require_read_confirmation ? (
          <>
            <p className="text-[15px] font-bold text-foreground">Finished reading?</p>
            <p className="text-[13px] font-medium text-muted-foreground">
              Press the button and your homework for this lesson opens underneath.
            </p>
            <Button
              icon={CheckCircle2}
              loading={markRead.isPending}
              onClick={() => markRead.mutate()}
            >
              I’ve finished reading
            </Button>
          </>
        ) : null}

        {homeworkHref ? (
          <Button
            className={cn(data.read && "cr-rowin")}
            icon={FileText}
            onClick={() => router.push(homeworkHref)}
          >
            Open the homework <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : data.read || !data.require_read_confirmation ? (
          // Read, and still nothing to open. Say which of the two reasons it is rather than
          // showing a dead button: "not released yet" and "you haven't confirmed" are
          // different situations and only one of them is the student's to fix.
          <p className="text-[13px] font-medium text-muted-foreground">
            {data.homework_released
              ? "The homework for this lesson isn’t available right now."
              : "No homework has been set for this lesson yet."}
          </p>
        ) : null}
      </Card>
    </HeroPage>
  );
}
