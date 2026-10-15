"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { peopleKeys, type PeopleSection } from "@/features/ops/changelist/peopleApi";
import { listHrefFrom } from "@/features/ops/changelist/backLink";
import { formatDate, formatLastSeen } from "@/features/ops/users/peopleColumns";
import { ConfirmBulkModal, type BulkResult } from "@/features/ops/users/ConfirmBulkModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { LINK_CLASS } from "./Fieldset";
import { formatPhone, LIST_LABEL } from "./format";
import { isNotFound, personActions, personKeys, usePerson, type PersonCore } from "./personApi";
import { PersonForm } from "./PersonForm";
import { PersonHeader } from "./PersonHeader";
import { activeTab, panelId, TabBar, tabHref, tabId, tabsFor, type TabKey } from "./PersonTabs";
import { SummaryCard } from "./SummaryCard";
import { GroupsSection } from "./sections/GroupsSection";
import { LcupSection } from "./sections/LcupSection";
import { StaffClassesSection } from "./sections/StaffClassesSection";
import { AttendanceSection } from "./sections/AttendanceSection";
import { ResultsSection } from "./sections/ResultsSection";
import { SecuritySection } from "./sections/SecuritySection";
import { HistorySection } from "./sections/HistorySection";

/**
 * One person's page. Close to Django admin's change form, made to be read: a header with their
 * photo, how to reach them and the account's state in colour, the figures that matter at a glance,
 * then tabs — the Overview (the form beside a Summary) and one subject per tab. A tab's part is
 * fetched when the tab opens. Back returns to the list it was opened from (`?_changelist_filters=`).
 */

type Dialog = "delete" | "revoke" | "otp" | null;

/** The other accounts with this name: the duplicates the owner keeps untangling, said before anything else. */
function SameNameNotice({ person }: { person: PersonCore }) {
  const n = person.duplicates.length;
  if (n === 0) return null;
  return (
    <div
      data-testid="same-name"
      className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3.5 text-sm text-warning-foreground"
    >
      <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">
          Same name as {n} other account{n === 1 ? "" : "s"} — check which one is theirs
        </p>
        <ul className="space-y-0.5">
          {person.duplicates.map((d) => (
            <li key={d.id} className="min-w-0 truncate">
              <Link href={`/ops/${d.section}/${d.id}`} prefetch={false} className={LINK_CLASS}>
                {d.name || d.username || `User ${d.id}`}
              </Link>
              <span>
                {" "}
                · {LIST_LABEL[d.section] ?? d.section}
                {d.groups.length > 0 ? ` · ${d.groups.join(", ")}` : ""} · last seen {formatLastSeen(d.last_seen)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PersonPage({ section, id }: { section: PeopleSection; id: number }) {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const query = usePerson(id);
  const person = query.data;
  const backHref = listHrefFrom(search, `/ops/${section}`);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [otpGiven, setOtpGiven] = useState<{ login: string; code: string; expires_at: string | null } | null>(null);

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

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6" aria-busy>
        <span className="sr-only">Loading…</span>
        <div className="h-44 animate-pulse rounded-2xl bg-surface-2" />
        <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
      </div>
    );
  }
  if (query.isError) {
    const missing = isNotFound(query.error);
    return (
      <div className="mx-auto w-full max-w-6xl space-y-2 p-4 text-sm md:p-6">
        <p className="text-muted-foreground">
          {missing ? "This account does not exist or is outside your scope." : "Could not load this account."}
        </p>
        <p className="flex gap-3">
          {missing ? null : (
            <button type="button" className={LINK_CLASS} onClick={() => void query.refetch()}>
              Retry
            </button>
          )}
          <Link href={backHref} className={LINK_CLASS}>
            Back to {LIST_LABEL[section]}
          </Link>
        </p>
      </div>
    );
  }
  if (!person || person.section !== section) return null;

  const tabs = tabsFor(person);
  const tab = activeTab(search, tabs);
  const openTab = (key: TabKey) =>
    router.replace(tabHref(`/ops/${section}/${id}`, new URLSearchParams(search.toString()), key), { scroll: false });

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
      setDialog(null);
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
      setDialog(null);
    }
  };

  const giveOneTimePassword = async () => {
    setBusy(true);
    try {
      setOtpGiven(await personActions.oneTimePassword(id));
      refresh();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      push({ tone: "error", message: typeof detail === "string" ? detail : "Could not give a one-time password." });
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  const lastFour = person.phone.replace(/\D/g, "").slice(-4);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="h-4 w-4" />
        {LIST_LABEL[section]}
      </Link>

      <PersonHeader
        person={person}
        busy={busy}
        onToggleFreeze={() => void bulk(person.is_frozen ? "unfreeze" : "freeze")}
        onOneTimePassword={() => setDialog("otp")}
        onRevoke={() => setDialog("revoke")}
        onDelete={() => setDialog("delete")}
      />

      <TabBar tabs={tabs} active={tab} onSelect={openTab} />

      {/* Only the open tab is rendered, so only its part is fetched. */}
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="min-w-0 space-y-5">
        {tab === "overview" ? (
          <>
            <SameNameNotice person={person} />
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <PersonForm key={person.id} person={person} onSaved={refresh} />
              <SummaryCard person={person} />
            </div>
          </>
        ) : null}
        {tab === "groups" ? <GroupsSection person={person} onChanged={refresh} /> : null}
        {tab === "payments" && person.lcup ? <LcupSection lcup={person.lcup} /> : null}
        {tab === "attendance" ? <AttendanceSection id={id} /> : null}
        {tab === "results" ? <ResultsSection id={id} section={section} /> : null}
        {tab === "security" ? (
          <SecuritySection id={id} person={person} onOneTimePassword={() => setDialog("otp")} />
        ) : null}
        {tab === "history" ? <HistorySection id={id} /> : null}
        {tab === "classes" && person.staff ? <StaffClassesSection staff={person.staff} /> : null}
      </div>

      {dialog === "delete" ? (
        <ConfirmBulkModal
          action="delete"
          count={1}
          attemptTotal={person.attempt_count}
          busy={busy}
          onCancel={() => (busy ? undefined : setDialog(null))}
          onConfirm={() => void bulk("delete")}
        />
      ) : null}
      {dialog === "revoke" ? (
        <ConfirmDialog
          title="Log out everywhere?"
          body="Every device is signed out. A tab that is open now keeps working for up to 3 hours."
          confirmLabel="Log out everywhere"
          busy={busy}
          onCancel={() => (busy ? undefined : setDialog(null))}
          onConfirm={() => void revoke()}
        />
      ) : null}
      {dialog === "otp" ? (
        <ConfirmDialog
          title="Give a one-time password?"
          body={
            <>
              <p>
                Their current password stops working and every device is signed out. They sign in once with their
                phone number and its last four digits, then choose a new password straight away.
              </p>
              <p className="rounded-lg bg-surface-2 px-3 py-2 font-medium text-foreground tabular-nums">
                {formatPhone(person.phone)} · password {lastFour}
              </p>
              <p>It works for 14 days.</p>
            </>
          }
          confirmLabel="Give one-time password"
          busy={busy}
          onCancel={() => (busy ? undefined : setDialog(null))}
          onConfirm={() => void giveOneTimePassword()}
        />
      ) : null}
      {otpGiven ? (
        <ConfirmDialog
          title="One-time password is ready"
          body={
            <>
              <p>Tell {person.first_name || person.name} to sign in with:</p>
              <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 rounded-lg bg-success-soft px-4 py-3 text-success-foreground">
                <dt>Login</dt>
                <dd className="font-semibold tabular-nums">{formatPhone(otpGiven.login)}</dd>
                <dt>Password</dt>
                <dd className="font-semibold tabular-nums">{otpGiven.code}</dd>
              </dl>
              <p>They choose their own password right after. Valid until {formatDate(otpGiven.expires_at)}.</p>
            </>
          }
          confirmLabel="Done"
          cancelLabel={null}
          busy={false}
          onCancel={() => setOtpGiven(null)}
          onConfirm={() => setOtpGiven(null)}
        />
      ) : null}
    </div>
  );
}
