"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { peopleKeys, type PeopleSection } from "@/features/ops/changelist/peopleApi";
import { listHrefFrom } from "@/features/ops/changelist/backLink";
import { formatLastSeen, statusLabel } from "@/features/ops/users/peopleColumns";
import { ConfirmBulkModal, type BulkResult } from "@/features/ops/users/ConfirmBulkModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { isNotFound, personActions, personKeys, usePerson, type PersonCore } from "./personApi";
import { PersonForm } from "./PersonForm";
import { GroupsSection } from "./sections/GroupsSection";
import { LcupSection } from "./sections/LcupSection";
import { DuplicatesSection, LIST_LABEL } from "./sections/DuplicatesSection";
import { StaffClassesSection } from "./sections/StaffClassesSection";
import { AttendanceSection } from "./sections/AttendanceSection";
import { ResultsSection } from "./sections/ResultsSection";
import { SecuritySection } from "./sections/SecuritySection";
import { HistorySection } from "./sections/HistorySection";

/**
 * One person's change form, after Django admin: the title row with the actions, the form
 * (Profile) beside Groups and lc-up (or a staff member's Classes), then the parts that load on
 * their own — Attendance, Results, Security, History — and the same-name accounts.
 * Back and the breadcrumb return to the list it was opened from (`?_changelist_filters=`).
 */

function ActionButton({ children, ...rest }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="h-8 rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function statusText(person: PersonCore): string {
  if (person.frozen_reason === "debt") return "Frozen — unpaid (lifts when paid)";
  if (person.frozen_reason === "admin") return "Frozen — by admin";
  return statusLabel(person.status, person.is_frozen);
}

export function PersonPage({ section, id }: { section: PeopleSection; id: number }) {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const query = usePerson(id);
  const person = query.data;
  const backHref = listHrefFrom(search, `/ops/${section}`);
  const [confirm, setConfirm] = useState<"delete" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);

  // The sync can move a person between sections (a student who left lc-up is public now);
  // their page follows them there.
  useEffect(() => {
    if (person && person.section !== section) router.replace(`/ops/${person.section}/${id}`);
  }, [person, section, id, router]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: personKeys.all });
    void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
    // The dashboard's learner counts move with a freeze, a delete or a seat.
    void queryClient.invalidateQueries({ queryKey: ["users", "population"] });
  };

  if (query.isPending) return <p className="p-4 text-sm text-muted-foreground md:p-6">Loading…</p>;
  if (query.isError) {
    const missing = isNotFound(query.error);
    return (
      <div className="space-y-2 p-4 text-sm md:p-6">
        <p className="text-muted-foreground">
          {missing ? "This account does not exist or is outside your scope." : "Could not load this account."}
        </p>
        <p className="flex gap-3">
          {missing ? null : (
            <button
              type="button"
              className="font-medium text-primary hover:underline dark:text-primary-hover"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          )}
          <Link href={backHref} className="text-primary hover:underline dark:text-primary-hover">
            Back to {LIST_LABEL[section]}
          </Link>
        </p>
      </div>
    );
  }
  if (!person || person.section !== section) return null;

  const bulk = async (action: "freeze" | "unfreeze" | "delete") => {
    setBusy(true);
    try {
      const r = await api.post("/users/admin/bulk/", { action, ids: [id] });
      const row: BulkResult | undefined = r.data?.results?.[0];
      if (!row?.ok) {
        // The server says why ("cannot delete: this account owns classrooms…").
        push({ tone: "error", message: row?.error ? `Not done: ${row.error}` : "That did not go through. Try again." });
        return;
      }
      if (action === "delete") {
        push({ tone: "success", message: "Account deleted." });
        void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
        void queryClient.invalidateQueries({ queryKey: ["users", "population"] });
        router.push(backHref);
        return;
      }
      push({ tone: "success", message: action === "freeze" ? "Account frozen." : "Account unfrozen." });
      refresh();
    } catch {
      push({ tone: "error", message: "That did not go through. Try again." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      const n = await personActions.revokeSessions(id);
      push({ tone: "success", message: `Signed out of ${n} device${n === 1 ? "" : "s"}.` });
      refresh();
    } catch {
      push({ tone: "error", message: "Could not sign them out. Try again." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const learner = person.staff === null;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
            <Link href={backHref} className="text-primary hover:underline dark:text-primary-hover">
              {LIST_LABEL[section]}
            </Link>{" "}
            › {person.name}
          </nav>
          <h1 className="mt-1 truncate text-xl font-semibold text-foreground">{person.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[person.username, statusText(person), `Last seen ${formatLastSeen(person.last_seen)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton disabled={busy} onClick={() => void bulk(person.is_frozen ? "unfreeze" : "freeze")}>
            {person.is_frozen ? "Unfreeze" : "Freeze"}
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => setConfirm("revoke")}>
            Log out everywhere
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => setConfirm("delete")}>
            Delete
          </ActionButton>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <PersonForm key={person.id} person={person} onSaved={refresh} />
        <div className="min-w-0 space-y-4">
          {learner ? (
            <>
              <GroupsSection person={person} onChanged={refresh} />
              {person.lcup ? <LcupSection lcup={person.lcup} /> : null}
            </>
          ) : (
            <StaffClassesSection staff={person.staff!} />
          )}
        </div>
      </div>

      {/* Attendance is taken in classes; a public user sits in none. */}
      {section === "students" ? <AttendanceSection id={id} /> : null}
      {learner ? <ResultsSection id={id} section={section} /> : null}
      <SecuritySection id={id} />
      <HistorySection id={id} />
      {learner ? <DuplicatesSection duplicates={person.duplicates} /> : null}

      {confirm === "delete" ? (
        <ConfirmBulkModal
          action="delete"
          count={1}
          attemptTotal={person.attempt_count}
          busy={busy}
          onCancel={() => (busy ? undefined : setConfirm(null))}
          onConfirm={() => void bulk("delete")}
        />
      ) : null}
      {confirm === "revoke" ? (
        <ConfirmDialog
          title="Log out everywhere?"
          body="Every device is signed out. A tab that is open now keeps working for up to 3 hours."
          confirmLabel="Log out everywhere"
          busy={busy}
          onCancel={() => (busy ? undefined : setConfirm(null))}
          onConfirm={() => void revoke()}
        />
      ) : null}
    </div>
  );
}
