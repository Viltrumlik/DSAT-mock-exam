"use client";

import { Suspense, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { ChangeList, type ChangeListAction, type ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import { useChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import {
  PEOPLE_FILTER_KEYS,
  peopleKeys,
  usePeople,
  type PeopleRowBase,
  type PeopleRowFor,
  type PeopleSection,
} from "@/features/ops/changelist/peopleApi";
import { ACTION_LABEL, ACTION_PAST, ConfirmBulkModal, type BulkAction, type BulkResult } from "./ConfirmBulkModal";
import { EditUserModal, type UserRecord } from "./EditUserModal";

/**
 * One of the /ops people lists — Students, Public users or Staff — on the shared changelist,
 * with the row editor and the bulk freeze / unfreeze / delete the old Users page had.
 */

type PeopleListProps<S extends PeopleSection> = {
  section: S;
  title: string;
  noun: { singular: string; plural: string };
  columns: ChangeListColumn<PeopleRowFor<S>>[];
  /** Bulk actions offered, in menu order. */
  bulk: readonly BulkAction[];
  searchPlaceholder?: string;
};

/** The editor's record from a list row. The row carries `name`; the editor needs its two parts. */
export function rowToUser(row: PeopleRowBase & { subject?: string }): { user: UserRecord; namesKnown: boolean } {
  const namesKnown = typeof row.first_name === "string" && typeof row.last_name === "string";
  const [first = "", ...rest] = row.name.trim().split(/\s+/);
  return {
    namesKnown,
    user: {
      id: row.id,
      username: row.username,
      email: row.email || null,
      first_name: namesKnown ? (row.first_name as string) : first,
      last_name: namesKnown ? (row.last_name as string) : rest.join(" "),
      phone_number: row.phone || null,
      role: row.role,
      is_frozen: row.is_frozen,
      subject: row.subject || null,
    },
  };
}

type Pending = { action: BulkAction; ids: number[]; attempts: number; resolve: (done: boolean) => void };

export function PeopleList<S extends PeopleSection>(props: PeopleListProps<S>) {
  // useSearchParams needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <PeopleListInner {...props} />
    </Suspense>
  );
}

function PeopleListInner<S extends PeopleSection>({
  section,
  title,
  noun,
  columns,
  bulk,
  searchPlaceholder,
}: PeopleListProps<S>) {
  const { params } = useChangeListParams(PEOPLE_FILTER_KEYS[section]);
  const query = usePeople(section, params);
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [editing, setEditing] = useState<{ user: UserRecord; namesKnown: boolean } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
    // The dashboard's learner counts move with a freeze or a delete.
    void queryClient.invalidateQueries({ queryKey: ["users", "population"] });
  }, [queryClient]);

  const rows = query.data?.results;
  const actions: ChangeListAction[] = bulk.map((action) => ({
    key: action,
    label: `${ACTION_LABEL[action]} selected ${noun.plural}`,
    run: (ids) =>
      new Promise<boolean>((resolve) => {
        const attempts = (rows ?? []).reduce((sum, r) => (ids.includes(r.id) ? sum + (r.attempt_count ?? 0) : sum), 0);
        setPending({ action, ids, attempts, resolve });
      }),
  }));

  const confirm = async () => {
    if (!pending) return;
    const { action, ids, resolve } = pending;
    setBusy(true);
    let done = false;
    try {
      const r = await api.post("/users/admin/bulk/", { action, ids });
      const results: BulkResult[] = Array.isArray(r.data?.results) ? r.data.results : [];
      const okCount = results.filter((x) => x.ok).length;
      const failed = results.filter((x) => !x.ok);
      const verb = ACTION_PAST[action];
      // The server says why a row was skipped ("cannot delete: this account owns classrooms…").
      const why = failed[0]?.error ? ` (${failed[0].error})` : "";
      if (okCount === 0) {
        push({ tone: "error", message: `Nothing ${verb} — ${failed.length} skipped${why}.` });
      } else if (failed.length === 0) {
        push({ tone: "success", message: `${okCount} account${okCount === 1 ? "" : "s"} ${verb}.` });
      } else {
        push({ tone: "error", message: `${okCount} ${verb}, ${failed.length} skipped${why}.` });
      }
      done = true;
      refresh();
    } catch {
      push({ tone: "error", message: "Bulk action failed. Please try again." });
    } finally {
      setBusy(false);
      setPending(null);
      resolve(done);
    }
  };

  const cancel = () => {
    if (busy || !pending) return;
    pending.resolve(false);
    setPending(null);
  };

  return (
    <>
      <ChangeList<PeopleRowFor<S>>
        title={title}
        noun={noun}
        columns={columns}
        data={query.data}
        loading={query.isPending}
        error={query.isError}
        fetching={query.isFetching && query.isPlaceholderData}
        onRetry={() => void query.refetch()}
        filterKeys={PEOPLE_FILTER_KEYS[section]}
        actions={actions}
        onRowClick={(row) => setEditing(rowToUser(row))}
        searchPlaceholder={searchPlaceholder}
        rowLabel={(row) => row.name || row.username}
      />

      {editing ? (
        <EditUserModal
          // A new row is a new form, not the last one's leftover state.
          key={editing.user.id}
          user={editing.user}
          namesKnown={editing.namesKnown}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}

      {pending ? (
        <ConfirmBulkModal
          action={pending.action}
          count={pending.ids.length}
          attemptTotal={pending.attempts}
          busy={busy}
          onCancel={cancel}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </>
  );
}
