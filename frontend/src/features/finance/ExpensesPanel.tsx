"use client";

import { useState, type FormEvent } from "react";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { Segmented, signedAmount } from "@/features/console/ui";
import { parseAmount } from "./LedgerEntryForm";
import { BOX, Btn, CONTROL, LoadError, Loading, SOM, TABLE, TD, TD_R, TEXT_BUTTON, TH, TH_R, TR, day, methodLabel, som } from "./FinancePanels";
import {
  useAddCategory,
  useAddExpense,
  useChangeCategory,
  useExpenseMeta,
  useExpenses,
  useVoidExpense,
  type ExpenseCategory,
  type ExpenseFilter,
  type ExpenseMeta,
  type ExpenseRow,
} from "./expensesApi";

/**
 * The centre's expenses, lc-up's "Xarajatlar" (owner 22 Nov 2026: expenses leave lc-up too; design approved the same
 * day). Filters from–to, category and who spent it, with the total over the table ("Jami"); a voided expense leaves
 * the total and waits in the Archive with who voided it and why — nothing is ever deleted.
 *
 * Entering, voiding and the category list are the owner's and the accountant's (`manage_expenses`); anyone who sees the
 * money reads them. Until the cutover lc-up keeps the expenses, so the form waits; the category list may be prepared.
 */

type View = "current" | "archive";

const LABEL = "flex flex-col gap-1 text-[12px] text-ms-fg-3";

function iso(date: Date): string {
  const part = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

export function monthBounds(now: Date = new Date()): { from: string; to: string } {
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
}

function Refusal({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] text-ms-critical-fg">
      {formatApiErrorForToast(error)}
    </p>
  );
}

function ExpenseForm({ meta, onClose }: { meta: ExpenseMeta; onClose: () => void }) {
  const add = useAddExpense();
  const [requestId] = useState(() => crypto.randomUUID());
  const [today] = useState(() => iso(new Date()));
  const active = meta.categories.filter((c) => !c.retired);
  const [raw, setRaw] = useState("");
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState(meta.methods[0]?.value ?? "");
  const [spentBy, setSpentBy] = useState(meta.staff.some((s) => s.id === meta.me) ? String(meta.me) : "");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const amount = parseAmount(raw);
  const canSave = amount !== null && Boolean(category && method && spentBy && date && reason.trim()) && !add.isPending;

  function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave || amount === null) return;
    add.mutate(
      { day: date, amount, category: Number(category), method, spent_by: Number(spentBy), reason: reason.trim(), request_id: requestId },
      { onSuccess: onClose },
    );
  }

  return (
    <form onSubmit={save} aria-label="Add an expense" className={cn(BOX, "space-y-2 px-3 py-3")}>
      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL}>
          Amount, {SOM}
          <input
            aria-label="Amount"
            inputMode="numeric"
            autoComplete="off"
            className={cn(CONTROL, "w-40 tabular-nums")}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          Category
          <select aria-label="Category" className={CONTROL} value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Choose a category</option>
            {active.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Method
          <select aria-label="Method" className={CONTROL} value={method} onChange={(event) => setMethod(event.target.value)}>
            {meta.methods.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Spent by
          <select aria-label="Spent by" className={CONTROL} value={spentBy} onChange={(event) => setSpentBy(event.target.value)}>
            <option value="">Choose a person</option>
            {meta.staff.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Date
          <input aria-label="Date" type="date" max={today} className={CONTROL} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className={cn(LABEL, "min-w-[14rem] flex-1")}>
          What for
          <input aria-label="What for" maxLength={300} className={CONTROL} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>
      <Refusal error={add.error} />
      <div className="flex flex-wrap gap-1">
        <Btn primary type="submit" disabled={!canSave}>
          {add.isPending ? "Saving…" : "Save expense"}
        </Btn>
        <Btn onClick={onClose} disabled={add.isPending}>Cancel</Btn>
      </div>
    </form>
  );
}

function VoidExpense({ row, onClose }: { row: ExpenseRow; onClose: () => void }) {
  const voidIt = useVoidExpense();
  const [reason, setReason] = useState("");
  const canSave = Boolean(reason.trim()) && !voidIt.isPending;

  function save(event: FormEvent) {
    event.preventDefault();
    if (canSave) voidIt.mutate({ id: row.id, reason: reason.trim() }, { onSuccess: onClose });
  }

  return (
    <form onSubmit={save} className="space-y-2 whitespace-normal py-1">
      <input
        aria-label="Why is this expense being voided?"
        placeholder="Why is this expense being voided?"
        maxLength={300}
        className={cn(CONTROL, "w-full max-w-md")}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Refusal error={voidIt.error} />
      <div className="flex flex-wrap gap-1">
        <Btn primary type="submit" disabled={!canSave}>
          {voidIt.isPending ? "Voiding…" : "Void this expense"}
        </Btn>
        <Btn onClick={onClose} disabled={voidIt.isPending}>Keep it</Btn>
      </div>
    </form>
  );
}

function CategoryRow({ category }: { category: ExpenseCategory }) {
  const change = useChangeCategory();
  const [name, setName] = useState<string | null>(null);

  function rename(event: FormEvent) {
    event.preventDefault();
    if (name?.trim()) change.mutate({ id: category.id, name: name.trim() }, { onSuccess: () => setName(null) });
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
      {name === null ? (
        <span className={cn("min-w-[10rem] font-medium", category.retired && "text-ms-fg-3 line-through")}>{category.name}</span>
      ) : (
        <form onSubmit={rename} className="flex flex-wrap items-center gap-1">
          <input aria-label={`New name for ${category.name}`} maxLength={80} className={CONTROL} value={name} onChange={(e) => setName(e.target.value)} />
          <Btn primary type="submit" disabled={!name.trim() || change.isPending}>Save</Btn>
          <Btn onClick={() => setName(null)}>Cancel</Btn>
        </form>
      )}
      <span className="text-[13px] tabular-nums text-ms-fg-3">{category.used === 1 ? "1 expense" : `${category.used} expenses`}</span>
      <span className="flex-1" />
      {name === null ? (
        <button type="button" className={TEXT_BUTTON} onClick={() => setName(category.name)}>Rename</button>
      ) : null}
      <button
        type="button"
        className={TEXT_BUTTON}
        disabled={change.isPending}
        onClick={() => change.mutate({ id: category.id, retired: !category.retired })}
      >
        {category.retired ? "Use again" : "Retire"}
      </button>
      <Refusal error={change.error} />
    </li>
  );
}

function CategoriesEditor({ meta, onClose }: { meta: ExpenseMeta; onClose: () => void }) {
  const add = useAddCategory();
  const [name, setName] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) add.mutate(name.trim(), { onSuccess: () => setName("") });
  }

  return (
    <section aria-label="Expense categories" className={BOX}>
      <div className="flex items-center gap-3 border-b border-ms-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-ms-fg">Categories</h2>
        <span className="text-[13px] text-ms-fg-3">A retired one keeps its old expenses and is not offered for new ones.</span>
        <span className="flex-1" />
        <Btn onClick={onClose}>Done</Btn>
      </div>
      <ul className="divide-y divide-ms-line">
        {meta.categories.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}
      </ul>
      <form onSubmit={save} className="flex flex-wrap items-center gap-1 border-t border-ms-border px-4 py-3">
        <input aria-label="New category" placeholder="New category" maxLength={80} className={CONTROL} value={name} onChange={(e) => setName(e.target.value)} />
        <Btn primary type="submit" disabled={!name.trim() || add.isPending}>Add category</Btn>
        <Refusal error={add.error} />
      </form>
    </section>
  );
}

export function ExpensesPanel() {
  const meta = useExpenseMeta();
  const [bounds] = useState(() => monthBounds());
  const [filter, setFilter] = useState<ExpenseFilter>({ ...bounds, category: "", spentBy: "", archived: false });
  const list = useExpenses(filter);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState<number | null>(null);
  const set = (part: Partial<ExpenseFilter>) => setFilter((f) => ({ ...f, ...part }));
  const view: View = filter.archived ? "archive" : "current";

  if (meta.isLoading) return <Loading />;
  if (meta.error || !meta.data) return <LoadError error={meta.error} onRetry={() => void meta.refetch()} />;
  const m = meta.data;
  const manage = m.can_manage;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL}>
          From
          <input aria-label="From" type="date" className={CONTROL} value={filter.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        </label>
        <label className={LABEL}>
          To
          <input aria-label="To" type="date" className={CONTROL} value={filter.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        </label>
        <label className={LABEL}>
          Category
          <select aria-label="Filter by category" className={CONTROL} value={filter.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All categories</option>
            {m.categories.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Spent by
          <select aria-label="Filter by who spent it" className={CONTROL} value={filter.spentBy} onChange={(e) => set({ spentBy: e.target.value })}>
            <option value="">Everyone</option>
            {m.staff.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
            ))}
          </select>
        </label>
        <Segmented<View>
          label="Expenses or the archive"
          size="sm"
          value={view}
          onChange={(v) => set({ archived: v === "archive" })}
          options={[
            { value: "current", label: "Expenses" },
            { value: "archive", label: "Archive" },
          ]}
        />
        <span className="flex-1" />
        {manage ? <Btn onClick={() => setEditing((open) => !open)}>Categories</Btn> : null}
        {manage ? (
          <Btn primary disabled={!m.open || adding} onClick={() => setAdding(true)}>
            Add an expense
          </Btn>
        ) : null}
      </div>
      {manage && !m.open ? (
        <p className="text-[13px] text-ms-fg-3">Expenses are entered here from the cutover; until then lc-up keeps them. The categories can be set up now.</p>
      ) : null}
      {editing ? <CategoriesEditor meta={m} onClose={() => setEditing(false)} /> : null}
      {adding ? <ExpenseForm meta={m} onClose={() => setAdding(false)} /> : null}
      <ExpenseTable list={list} archive={filter.archived} manage={manage && m.open} voiding={voiding} onVoid={setVoiding} />
    </div>
  );
}

function ExpenseTable({
  list,
  archive,
  manage,
  voiding,
  onVoid,
}: {
  list: ReturnType<typeof useExpenses>;
  archive: boolean;
  manage: boolean;
  voiding: number | null;
  onVoid: (id: number | null) => void;
}) {
  if (list.isLoading) return <Loading />;
  if (list.error || !list.data) return <LoadError error={list.error} onRetry={() => void list.refetch()} />;
  const data = list.data;
  const range = `${day(data.from)} – ${day(data.to)}`;
  if (!data.rows.length) {
    return (
      <p className={cn(BOX, "px-4 py-4 text-[14px] text-ms-fg-3")}>
        {archive ? `No voided expenses for ${range}.` : `No expenses for ${range}.`}
      </p>
    );
  }
  const columns = archive || manage ? 8 : 7;

  return (
    <>
      <p className="text-[14px] text-ms-fg-2">
        <span className="tabular-nums">{data.count === 1 ? "1 expense" : `${data.count} expenses`}</span>
        {" · "}
        {archive ? "Voided" : "Total"} <span className="font-semibold tabular-nums text-ms-fg">{som(data.total)}</span>
        {data.by_category.length > 1 ? <> · {data.by_category.map((c) => `${c.name} ${signedAmount(c.total)}`).join(" · ")}</> : null}
        {data.truncated ? " · the newest 1,000 are listed" : null}
      </p>
      <div className={cn(BOX, "overflow-x-auto")}>
        <table className={TABLE}>
          <caption className="sr-only">
            {archive ? "Voided expenses" : "Expenses"}, {range}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Date</th>
              <th scope="col" className={TH}>Category</th>
              <th scope="col" className={TH_R}>Amount, {SOM}</th>
              <th scope="col" className={TH}>Method</th>
              <th scope="col" className={TH}>Spent by</th>
              <th scope="col" className={TH}>What for</th>
              <th scope="col" className={TH}>{archive ? "Voided" : "Entered by"}</th>
              {archive ? <th scope="col" className={TH}>Why</th> : null}
              {!archive && manage ? (
                <th scope="col" className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <ExpenseLine key={row.id} row={row} archive={archive} manage={manage} voiding={voiding === row.id} onVoid={onVoid} columns={columns} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExpenseLine({
  row,
  archive,
  manage,
  voiding,
  onVoid,
  columns,
}: {
  row: ExpenseRow;
  archive: boolean;
  manage: boolean;
  voiding: boolean;
  onVoid: (id: number | null) => void;
  columns: number;
}) {
  return (
    <>
      <tr className={TR}>
        <td className={cn(TD, "tabular-nums")}>{day(row.day)}</td>
        <td className={cn(TD, "font-medium")}>{row.category.name}</td>
        <td className={cn(TD_R, "font-semibold")}>{signedAmount(row.amount)}</td>
        <td className={TD}>{methodLabel(row.method)}</td>
        <td className={TD}>{row.spent_by.name || "—"}</td>
        <td className={cn(TD, "max-w-[22rem] truncate")} title={row.reason}>
          {row.reason}
        </td>
        {archive ? (
          <td className={TD}>
            {day(row.voided_at)}
            {row.voided_by ? <span className="text-ms-fg-3"> · {row.voided_by}</span> : null}
          </td>
        ) : (
          <td className={cn(TD, "text-ms-fg-3")}>{row.created_by || "—"}</td>
        )}
        {archive ? (
          <td className={cn(TD, "max-w-[18rem] truncate")} title={row.void_reason}>
            {row.void_reason}
          </td>
        ) : manage ? (
          <td className={TD}>
            {voiding ? null : (
              <button
                type="button"
                className={TEXT_BUTTON}
                onClick={() => onVoid(row.id)}
                aria-label={`Void the ${row.category.name} expense of ${day(row.day)}`}
              >
                Void
              </button>
            )}
          </td>
        ) : null}
      </tr>
      {voiding ? (
        <tr>
          <td colSpan={columns} className={TD}>
            <VoidExpense row={row} onClose={() => onVoid(null)} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
