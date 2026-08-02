"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { mockApi, type MockSessionPlace } from "@/lib/mockApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";

/**
 * The invigilated half of the student's mock page: type the code, wait to be let in, and be
 * taken into the paper the moment the room starts.
 *
 * It POLLS. There is no usable push transport on this deployment — the SSE endpoint parks a
 * synchronous gunicorn worker per client and there are three workers in total, so thirty
 * students holding a stream would take the site down. A five-second poll of one small row
 * is the honest trade, and it only runs while a student is actually waiting for something.
 */

const C = { navy: "#0f1729", blue: "#2a68c0", slate: "#64748b", border: "#e7ebf3" };

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

  const { data, refetch } = useQuery({
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
    <div className="rounded-2xl border bg-white p-5" style={{ borderColor: C.border }}>
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4" style={{ color: C.blue }} />
        <p className="text-[15px] font-extrabold" style={{ color: C.navy }}>
          Sitting a mock with your teacher?
        </p>
      </div>
      <p className="mt-1 text-[13px] font-medium" style={{ color: C.slate }}>
        Enter the 6-digit code your teacher gives you. They let you in, and the exam opens for
        everyone at the same moment.
      </p>

      <form onSubmit={join} className="mt-4 flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="000000"
          aria-label="Session code"
          className="w-40 rounded-xl border px-4 py-3 text-center text-[18px] font-extrabold tracking-[0.3em] tabular-nums outline-none focus:border-slate-400"
          style={{ borderColor: C.border, color: C.navy }}
        />
        <button
          type="submit"
          disabled={busy || code.trim().length !== 6}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          style={{ background: C.blue }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Request a place
        </button>
      </form>

      {places.length > 0 && (
        <ul className="mt-4 space-y-2">
          {places.map((p) => (
            <li
              key={p.session_id}
              className="flex items-center gap-3 rounded-xl border px-4 py-3"
              style={{ borderColor: C.border }}
            >
              <PlaceIcon place={p} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold" style={{ color: C.navy }}>
                  {p.title}
                </p>
                <p className="text-[12px] font-semibold" style={{ color: C.slate }}>
                  {placeLabel(p)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlaceIcon({ place }: { place: MockSessionPlace }) {
  if (place.my_status === "REJECTED") return <ShieldAlert className="h-4 w-4 text-red-600" />;
  if (place.my_status === "APPROVED") return <Check className="h-4 w-4 text-emerald-600" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
}

function placeLabel(p: MockSessionPlace): string {
  if (p.my_status === "REJECTED") return "Your request was not approved.";
  if (p.status === "ENDED") return "This sitting has finished.";
  if (p.my_status === "PENDING") return "Waiting for your teacher to let you in…";
  if (p.status === "STARTED") return "Started — opening your exam…";
  return "You're in. The exam opens when your teacher starts it.";
}
