"use client";

import { Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import type { IconName } from "@/components/ui/Icon";
import { toast } from "@/features/console/toast";
import { ConfirmDialog } from "@/features/console/ui";
import { ChangeList, type ChangeListAction, type ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import { useChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { withListFilters } from "@/features/ops/changelist/backLink";
import {
  PEOPLE_FILTER_KEYS,
  peopleKeys,
  usePeople,
  type PeopleRowFor,
  type PeopleSection,
} from "@/features/ops/changelist/peopleApi";
import { ACTION_LABEL, ACTION_PAST, type BulkAction, type BulkResult } from "./ConfirmBulkModal";

/**
 * One of the /ops people lists — Students, Public users or Staff — on the shared changelist,
 * each row linking to the person's change form (`/ops/<section>/<id>`, carrying the list's
 * address back), with the bulk freeze / unfreeze / delete the old Users page had.
 */

type PeopleListProps<S extends PeopleSection> = {
  section: S;
  title: string;
  noun: { singular: string; plural: string };
  columns: ChangeListColumn<PeopleRowFor<S>>[];
  /** Bulk actions offered, in menu order. */
  bulk: readonly BulkAction[];
  searchPlaceholder?: string;
  /** Beside the list's title: the Staff page's "New staff account". */
  headerAction?: ReactNode;
};

type Pending = {
  action: BulkAction;
  ids: number[];
  /** Graded or submitted rows across the selection: a delete cascades to every one of them. */
  attempts: number;
  names: string[];
  /** How many of them lc-up holds frozen for debt: a staff freeze or unfreeze changes what lifts it. */
  debtFrozen: number;
  resolve: (done: boolean) => void;
};

const ICON: Record<BulkAction, IconName> = { freeze: "snow", unfreeze: "sun", delete: "trash" };

/**
 * The dialog's words (design handoff v0.3, Overlays board): the question with the name or the count,
 * the consequences in plain words, the action and the count on the button. Freezing is not undoable
 * here — it takes the student out of the class Telegram groups, and unfreezing makes the bot message
 * them — so it asks first and says so.
 */
function dialogCopy(p: Pending, noun: { singular: string; plural: string }) {
  const n = p.ids.length;
  const who = n === 1 ? p.names[0] : `${n} ${noun.plural}`;
  const debt = p.debtFrozen;
  if (p.action === "freeze") {
    return {
      title: `Freeze ${who}?`,
      tone: "frozen" as const,
      confirmLabel: n === 1 ? "Freeze" : `Freeze ${n}`,
      busyLabel: "Freezing…",
      doneLabel: "Frozen",
      body: (
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>They can’t open homework, tests or mocks until unfrozen.</li>
          <li>They leave their classes’ Telegram groups; unfreezing makes the bot offer the groups back.</li>
          {debt ? (
            <li>
              <b className="text-ms-fg">{debt} already frozen for debt</b> become a staff freeze: a payment will no longer lift it.
            </li>
          ) : null}
        </ul>
      ) as ReactNode,
    };
  }
  if (p.action === "unfreeze") {
    return {
      title: `Unfreeze ${who}?`,
      tone: "info" as const,
      confirmLabel: n === 1 ? "Unfreeze" : `Unfreeze ${n}`,
      busyLabel: "Unfreezing…",
      doneLabel: "Unfrozen",
      body: (
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>They can open homework, tests and mocks again at once.</li>
          <li>The class bot messages them to offer their Telegram groups back. A message can’t be recalled.</li>
          {debt ? (
            <li>
              <b className="text-ms-fg">{debt} frozen for debt</b> are let in although lc-up still shows the debt.
            </li>
          ) : null}
        </ul>
      ) as ReactNode,
    };
  }
  return {
    title: n === 1 ? `Delete ${who}’s account?` : `Delete ${n} accounts?`,
    tone: "critical" as const,
    confirmLabel: n === 1 ? "Delete account" : `Delete ${n} accounts`,
    busyLabel: "Deleting…",
    doneLabel: "Deleted",
    body: (
      <>
        <p>
          Removes {n === 1 ? "their" : "these accounts’"} sign-in, results and history from MasterSAT. lc-up keeps its own record.{" "}
          <b className="text-ms-fg">This cannot be undone.</b>
        </p>
        {p.attempts > 0 ? (
          <p className="font-semibold text-ms-critical-fg">
            {p.attempts.toLocaleString("en-US")} exam {p.attempts === 1 ? "result is" : "results are"} deleted with {n === 1 ? "this account" : "these accounts"}.
          </p>
        ) : null}
      </>
    ) as ReactNode,
  };
}

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
  headerAction,
}: PeopleListProps<S>) {
  const { params, queryString } = useChangeListParams(PEOPLE_FILTER_KEYS[section]);
  const query = usePeople(section, params);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const succeeded = useRef(false);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
    // The dashboard's learner counts move with a freeze or a delete.
    void queryClient.invalidateQueries({ queryKey: ["users", "population"] });
  }, [queryClient]);

  const rows = query.data?.results;
  const actions: ChangeListAction[] = bulk.map((action) => ({
    key: action,
    label: `${ACTION_LABEL[action]} selected ${noun.plural}`,
    // The bulk bar's words; Delete asks first (the confirm dialog), so it ends in an ellipsis.
    short: action === "delete" ? `${ACTION_LABEL[action]}…` : ACTION_LABEL[action],
    icon: action === "freeze" ? "snow" : action === "delete" ? "trash" : undefined,
    run: (ids) =>
      new Promise<boolean>((resolve) => {
        const picked = (rows ?? []).filter((r) => ids.includes(r.id));
        succeeded.current = false;
        setPending({
          action,
          ids,
          resolve,
          attempts: picked.reduce((sum, r) => sum + (r.attempt_count ?? 0), 0),
          names: picked.map((r) => r.name || r.username || `User ${r.id}`),
          debtFrozen: picked.filter((r) => r.status === "frozen_debt").length,
        });
        setOpen(true);
      }),
  }));

  // Runs inside the dialog: the button shows its progress, and a failure shakes the dialog and stays
  // there to be read (never only in a toast).
  const confirm = async () => {
    if (!pending) return;
    const { action, ids, names } = pending;
    let data: { results?: unknown } | undefined;
    try {
      data = (await api.post("/users/admin/bulk/", { action, ids })).data;
    } catch {
      throw new Error("Couldn’t reach the server. Check the list, then try again.");
    }
    const list = data?.results;
    const results: BulkResult[] = Array.isArray(list) ? (list as BulkResult[]) : [];
    const okCount = results.filter((x) => x.ok).length;
    const failed = results.filter((x) => !x.ok);
    const verb = ACTION_PAST[action];
    // The server says why a row was skipped ("cannot delete: this account owns classrooms…").
    const why = failed[0]?.error ? ` (${failed[0].error})` : "";
    refresh();
    if (okCount === 0) throw new Error(`Nothing ${verb} — ${failed.length} skipped${why}.`);
    succeeded.current = true;
    const who = okCount === 1 && ids.length === 1 ? names[0] : `${okCount} ${okCount === 1 ? noun.singular : noun.plural}`;
    toast.show({
      icon: ICON[action],
      tone: failed.length ? "error" : "neutral",
      message: failed.length ? `${okCount} ${verb}, ${failed.length} skipped${why}.` : `${who} ${verb}.`,
    });
  };

  const close = () => {
    setOpen(false);
    pending?.resolve(succeeded.current);
  };

  const copy = pending ? dialogCopy(pending, noun) : null;
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
        rowHref={(row) => withListFilters(`/ops/${section}/${row.id}`, queryString)}
        searchPlaceholder={searchPlaceholder}
        headerAction={headerAction}
        rowLabel={(row) => row.name || row.username}
      />

      {pending && copy ? (
        <ConfirmDialog
          open={open}
          onClose={close}
          title={copy.title}
          icon={ICON[pending.action]}
          tone={copy.tone}
          confirmLabel={copy.confirmLabel}
          busyLabel={copy.busyLabel}
          doneLabel={copy.doneLabel}
          confirmIcon={ICON[pending.action]}
          typeToConfirm={pending.action === "delete" ? "DELETE" : undefined}
          onConfirm={confirm}
        >
          {copy.body}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
