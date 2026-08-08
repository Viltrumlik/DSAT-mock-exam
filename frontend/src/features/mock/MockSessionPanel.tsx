"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock, KeyRound, ShieldAlert } from "lucide-react";
import { mockApi, type MockSessionPlace } from "@/lib/mockApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Button, Card } from "@/features/classroom/ui";

/**
 * The invigilated half of the student's mock page: type the code, wait to be let in, and be
 * taken into the paper the moment the room starts.
 *
 * It POLLS. There is no usable push transport on this deployment — the SSE endpoint parks a
 * synchronous gunicorn worker per client and there are three workers in total, so thirty
 * students holding a stream would take the site down. A five-second poll of one small row
 * is the honest trade, and it only runs while a student is actually waiting for something.
 */

/** Waiting on someone else — poll. Decided and started, or refused — stop. */
function isWaiting(p: MockSessionPlace): boolean {
  if (p.my_status === "REJECTED") return false;
  if (p.my_status === "PENDING") return true;
  return p.status !== "STARTED" && p.status !== "ENDED";
}

export default function MockSessionPanel() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isError, refetch } = useQuery({
    queryKey: ["mock", "sessions", "mine"],
    queryFn: mockApi.mySessions,
  });
  const places = useMemo(() => data ?? [], [data]);

  // Only the places that still have something to wait for keep the poll alive.
  const waiting = useMemo(() => places.filter(isWaiting), [places]);
  useEffect(() => {
    if (waiting.length === 0) return;
    const t = setInterval(() => void refetch(), 5000);
    return () => clearInterval(t);
  }, [waiting.length, refetch]);

  // The room started and this student is in it: go, without asking them to click anything.
  // A student who has walked away must still find their paper running when they come back,
  // which is why this fires off the polled snapshot rather than off a button.
  const ready = places.find((p) => p.attempt_id != null && p.status === "STARTED");
  useEffect(() => {
    if (!ready?.attempt_id) return;
    router.push(`/exam/${ready.attempt_id}?src=mock`);
  }, [ready?.attempt_id, router]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = code.trim();
    if (cleaned.length !== 6) return;
    setBusy(true);
    try {
      await mockApi.joinSession(cleaned);
      setCode("");
      await refetch();
    } catch (err) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(err).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="cr-card">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" aria-hidden />
        <p className="text-[15px] font-extrabold text-foreground">
          Sitting a mock with your teacher?
        </p>
      </div>
      <p className="mt-1 text-[13px] font-medium text-muted-foreground">
        Enter the 6-digit code your teacher gives you. They let you in, and the exam opens for
        everyone at the same moment.
      </p>

      <form onSubmit={join} className="mt-4 flex flex-wrap gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="000000"
          aria-label="Session code"
          className="ds-ring w-40 rounded-xl border border-border bg-card px-4 py-3 text-center text-[18px] font-extrabold tracking-[0.3em] text-foreground outline-none transition-colors tabular-nums placeholder:text-muted-foreground focus:border-primary"
        />
        <Button
          type="submit"
          size="lg"
          className="cr-press"
          loading={busy}
          disabled={code.trim().length !== 6}
        >
          Request a place
        </Button>
      </form>

      {/* A student who has asked for a place and is waiting must keep seeing that they asked.
          When this list failed to load it simply disappeared, which reads as "your request is
          gone" at the exact moment they are watching for it. */}
      {isError && (
        <p className="mt-3 text-[13px] font-semibold text-amber-600 dark:text-amber-400">
          Couldn&apos;t check your sittings just now — any place you&apos;ve requested is still
          held.{" "}
          <button type="button" onClick={() => void refetch()} className="ds-ring rounded underline">
            Try again
          </button>
        </p>
      )}

      {places.length > 0 && (
        <ul className="mt-4 space-y-2">
          {places.map((p, i) => (
            <li
              key={p.session_id}
              style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}
              className="cr-rowin flex items-center gap-3 rounded-xl border border-border px-4 py-3"
            >
              <PlaceIcon place={p} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold text-foreground">{p.title}</p>
                <p className="text-[12px] font-semibold text-muted-foreground">{placeLabel(p)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlaceIcon({ place }: { place: MockSessionPlace }) {
  if (place.my_status === "REJECTED") return <ShieldAlert className="h-4 w-4 shrink-0 text-rose-500" aria-hidden />;
  if (place.my_status === "APPROVED") return <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
  return <Clock className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />;
}

function placeLabel(p: MockSessionPlace): string {
  if (p.my_status === "REJECTED") return "Your request was not approved.";
  if (p.status === "ENDED") return "This sitting has finished.";
  if (p.my_status === "PENDING") return "Waiting for your teacher to let you in…";
  if (p.status === "STARTED") return "Started — opening your exam…";
  return "You're in. The exam opens when your teacher starts it.";
}
