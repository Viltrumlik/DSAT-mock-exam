"use client";

import { Fragment, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/ui/Icon";
import { RollNumber } from "@/features/console/RollNumber";
import { clearFlash, markReturn, peekFlash } from "@/features/console/flash";
import { toast } from "@/features/console/toast";
import {
  BulkBar,
  Button,
  Checkbox,
  ChipCount,
  EmptyState,
  ErrorState,
  FilterChip,
  Pagination,
  SearchField,
  Sheet,
  bulkButtonClass,
  chipClass,
  follow,
  usePresence,
} from "@/features/console/ui";
import { cn } from "@/lib/cn";
import { PAGE_SIZES, useChangeListParams, type ChangeListPatch } from "./useChangeListParams";

export { pageWindow } from "@/features/console/ui";

/**
 * A list page (design handoff v0.3, DataDisplay board, "The changelist, rebuilt"): Django admin's
 * shape — search, a filter column with a count beside every choice, actions on ticked rows — with
 * the console's hierarchy. One card holds the toolbar (title, count, search, the page's button), a
 * chip bar (quick filters, the filters in force), the filter column on the left and the table;
 * ticking a row brings up the bulk bar. The state lives in the address (useChangeListParams); the
 * data comes from the page's own query, so this draws whatever list it is handed.
 */

export type ChangeListFilterOption = { value: string; label: string; count: number };

export type ChangeListFilter = {
  key: string;
  label: string;
  options: ChangeListFilterOption[];
  selected: string | null;
};

/** The page of results a changelist draws — the shape `GET /users/admin/people/` answers with. */
export type ChangeListData<R> = {
  count: number;
  page: number;
  pages: number;
  page_size: number;
  /** The ordering the server applied (its default when the address names none). */
  ordering?: string;
  results: R[];
  filters: ChangeListFilter[];
};

export type ChangeListColumn<R> = {
  key: string;
  label: string;
  render: (row: R) => ReactNode;
  /** Server ordering key: ascending is `sortKey`, descending `-sortKey`. */
  sortKey?: string;
  /** Instead of `sortKey`, for a column that sorts one way only (e.g. `{ desc: "debt" }`). */
  sortKeys?: { asc?: string; desc?: string };
  /** Classes for the column's header and cells (width, alignment, truncation). */
  className?: string;
};

export type ChangeListAction = {
  key: string;
  /** The whole name: "Freeze selected students" (the button's accessible name). */
  label: string;
  /** What the bulk bar shows: "Freeze". Defaults to `label`. */
  short?: string;
  icon?: IconName;
  /** Resolve `true` when the action went through: the selection then clears, as after a Django action. */
  run: (ids: number[]) => void | boolean | Promise<boolean | void>;
};

export type ChangeListProps<R extends { id: number }> = {
  title: string;
  /** For counts: "219 students", "1 student". */
  noun: { singular: string; plural: string };
  columns: ChangeListColumn<R>[];
  data: ChangeListData<R> | undefined;
  /** True only while there is nothing to show yet; a page change keeps the previous rows. */
  loading: boolean;
  error: boolean;
  /** A new page is on its way while the previous one is still shown. */
  fetching?: boolean;
  onRetry: () => void;
  /** The filter keys this list understands; other query keys are ignored. */
  filterKeys?: readonly string[];
  actions?: ChangeListAction[];
  onRowClick?: (row: R) => void;
  /** Each row's change form. The first cell becomes a link, so it opens in a new tab. */
  rowHref?: (row: R) => string;
  /** The page's own controls beside the search, e.g. "Add student" (the screen's one primary button). */
  headerAction?: ReactNode;
  searchPlaceholder?: string;
  /** Names a row for its checkbox's label; defaults to the id. */
  rowLabel?: (row: R) => string;
  /** Rows with the same key share a header row, drawn before the first of them (the SMS journal's days). */
  groupBy?: (row: R) => string;
  groupLabel?: (key: string) => ReactNode;
  /** A card per row below the `sm` breakpoint, instead of the table (under the same group headers). */
  mobileCard?: (row: R) => ReactNode;
  /**
   * The filters in force, as chips, when the page knows them better than the filter column does
   * (the SMS journal's dates are not facets). By default: each chosen filter, "Status: Frozen".
   */
  filterChips?: { key: string; label: string }[];
};

function sortKeysOf<R>(col: ChangeListColumn<R>): { asc?: string; desc?: string } | null {
  if (col.sortKeys) return col.sortKeys;
  if (col.sortKey) return { asc: col.sortKey, desc: `-${col.sortKey}` };
  return null;
}

/** Ascending → descending → ascending; a one-way column toggles between itself and the default. */
function nextOrdering(keys: { asc?: string; desc?: string }, current: string): string | null {
  if (current && current === keys.asc) return keys.desc ?? null;
  if (current && current === keys.desc) return keys.asc ?? null;
  return keys.asc ?? keys.desc ?? null;
}

/** The quick chips are the first filter's choices, while there are few enough to sit in one bar. */
const QUICK_MAX = 6;

export function ChangeList<R extends { id: number }>({
  title,
  noun,
  columns,
  data,
  loading,
  error,
  fetching = false,
  onRetry,
  filterKeys,
  actions,
  onRowClick,
  rowHref,
  headerAction,
  searchPlaceholder,
  rowLabel,
  groupBy,
  groupLabel,
  mobileCard,
  filterChips,
}: ChangeListProps<R>) {
  const router = useRouter();
  const pathname = usePathname();
  const { params, queryString, hrefFor, update } = useChangeListParams(filterKeys);
  const rows = data?.results;
  const filters = data?.filters ?? [];
  const active = params.filters;
  const ordering = params.o || data?.ordering || "";
  const hasActions = Boolean(actions && actions.length > 0);

  // ── Selection: per page, as in Django. A new search, filter, sort or page starts empty. ──
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [selectionFor, setSelectionFor] = useState(queryString);
  if (selectionFor !== queryString) {
    setSelectionFor(queryString);
    setSelected(new Set());
  }
  // Only rows on the page count, so a row that left the list (deleted, refiltered) cannot be acted on.
  const selectedIds = (rows ?? []).filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = Boolean(rows && rows.length > 0 && selectedIds.length === rows.length);
  const someSelected = selectedIds.length > 0 && !allSelected;

  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set((rows ?? []).map((r) => r.id)));

  // ── Bulk actions ──
  const [running, setRunning] = useState(false);
  const runAction = async (action: ChangeListAction) => {
    if (selectedIds.length === 0) return;
    setRunning(true);
    try {
      const done = await action.run(selectedIds);
      if (done === true) setSelected(new Set());
    } finally {
      setRunning(false);
    }
  };

  // ── Filters sheet (below 1600 px, where the column does not fit) ──
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── The bulk bar sinks out after the last tick is cleared, still saying how many it held ──
  const barOpen = hasActions && selectedIds.length > 0;
  const bar = usePresence(barOpen, 120);
  const [barCount, setBarCount] = useState(0);
  if (selectedIds.length > 0 && selectedIds.length !== barCount) setBarCount(selectedIds.length);

  // ── "You are here": the row you open is noted; coming back to this list, it glows once ──
  const [flashId] = useState(() => peekFlash(pathname));
  const [flashLive, setFlashLive] = useState(true);
  const rowsShown = rows?.length ?? 0;
  useEffect(() => {
    if (!flashId || !rowsShown) return;
    clearFlash();
    [...document.querySelectorAll<HTMLElement>("[data-row-id]")].find((el) => el.dataset.rowId === flashId)?.scrollIntoView?.({ block: "nearest" });
    const t = window.setTimeout(() => setFlashLive(false), 1600);
    return () => window.clearTimeout(t);
  }, [flashId, rowsShown]);

  const go = (patch: ChangeListPatch, keepPage = false) => update(patch, keepPage);
  const colSpan = columns.length + (hasActions ? 1 : 0);
  const count = data?.count ?? 0;
  const page = data?.page ?? params.page;
  const pages = data?.pages ?? 1;
  const countText = `${count.toLocaleString("en-US")} ${count === 1 ? noun.singular : noun.plural}`;

  // The filters in force, as chips; "Clear all" clears exactly these.
  const chips =
    filterChips ??
    filters.flatMap((f) => {
      const value = active[f.key];
      if (!value) return [];
      const option = f.options.find((o) => o.value === value);
      return [{ key: f.key, label: `${f.label}: ${option?.label ?? value}` }];
    });
  const clearChips: ChangeListPatch = Object.fromEntries(chips.map((c) => [c.key, null]));
  // Clearing filters is exactly reversible, so it runs at once and offers Undo (Overlays board).
  const clearAll = () => {
    const before: ChangeListPatch = Object.fromEntries(chips.map((c) => [c.key, active[c.key] ?? null]));
    const n = chips.length;
    go(clearChips);
    toast.show({ icon: "filter", message: `Cleared ${n} ${n === 1 ? "filter" : "filters"}`, undo: () => go(before) });
  };
  const quick = filters[0] && filters[0].options.length <= QUICK_MAX ? filters[0] : null;
  const narrowed = Boolean(params.q) || chips.length > 0;

  const filterColumn = (onPicked?: () => void, trailing?: ReactNode) => (
    <FilterColumn
      filters={filters}
      active={active}
      hrefFor={hrefFor}
      trailing={trailing}
      onPick={(patch) => {
        go(patch);
        onPicked?.();
      }}
    />
  );

  return (
    <div className="flex flex-col">
      <section className="animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
        {/* ── toolbar ── */}
        <header className="flex flex-wrap items-center gap-3 border-b border-ms-border px-5 py-4">
          <h1 className="text-ms-title text-ms-fg">
            {title}
            {data ? (
              <>
                {" "}
                <RollNumber value={count.toLocaleString("en-US")} className="font-medium text-ms-fg-3" />
              </>
            ) : null}
          </h1>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <SearchField
              value={params.q}
              placeholder={searchPlaceholder ?? `Search ${noun.plural}`}
              onSearch={(q) => go({ q })}
              className="sm:w-[340px]"
            />
            {filters.length > 0 ? (
              <Button icon="sliders" onClick={() => setSheetOpen(true)} aria-expanded={sheetOpen} className="min-[1600px]:hidden">
                Filters{chips.length ? ` (${chips.length})` : ""}
              </Button>
            ) : null}
            {headerAction}
          </div>
        </header>

        {/* ── chip bar: quick filters, the filters in force, how many ── */}
        {quick || chips.length || data ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-ms-border px-5 py-3">
            {quick ? (
              <div role="group" aria-label={`Quick filter: ${quick.label}`} className="flex flex-wrap items-center gap-2">
                {[{ value: null as string | null, label: "All", count: undefined as number | undefined }, ...quick.options].map((item) => {
                  const on = item.value === (active[quick.key] ?? null);
                  const patch = { [quick.key]: item.value };
                  return (
                    <a
                      key={item.value ?? "__all"}
                      href={hrefFor(patch)}
                      aria-current={on ? "true" : undefined}
                      onClick={(e) => follow(e, () => go(patch))}
                      className={chipClass(on, item.count === 0)}
                    >
                      {item.label}
                      {item.count !== undefined ? <ChipCount n={item.count} on={on} /> : null}
                    </a>
                  );
                })}
              </div>
            ) : null}
            {chips.length ? (
              <>
                {quick ? <span aria-hidden="true" className="mx-1.5 h-6 w-px bg-ms-border-strong" /> : null}
                {chips.map((c) => (
                  <FilterChip key={c.key} label={c.label} onRemove={() => go({ [c.key]: null })} />
                ))}
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear all
                </Button>
              </>
            ) : null}
            {data ? <span className="ml-auto text-[14px] tabular-nums text-ms-fg-2">{countText}</span> : null}
          </div>
        ) : null}

        {/* The filter column needs 264 px beside a seven-column table: from 1600 px wide. Narrower,
            the same filters open in a side sheet, and the chip bar keeps the quick ones in view. */}
        <div className={cn("grid", filters.length > 0 && "min-[1600px]:grid-cols-[264px_minmax(0,1fr)]")}>
          {filters.length > 0 ? (
            <aside aria-label="Filters" className="relative hidden min-h-[28rem] border-r border-ms-border bg-ms-surface min-[1600px]:block">
              {/* Scrolls within the table's height rather than stretching the card past it. */}
              <div className="absolute inset-0 overflow-y-auto px-4 pb-5 pt-1">{filterColumn()}</div>
            </aside>
          ) : null}

          <div className="min-w-0">
            {error ? (
              <div className="p-5">
                <ErrorState what={noun.plural} onRetry={onRetry} />
              </div>
            ) : (
              <div
                className={cn(
                  // Its own scroll pane from md up, so the header row can stick while the rows scroll
                  // (a sticky header cannot stick to the page through a horizontal-scroll wrapper).
                  "overflow-x-auto transition-opacity md:max-h-[calc(100dvh-17rem)] md:overflow-y-auto",
                  fetching && "opacity-60",
                  mobileCard && "hidden sm:block",
                )}
                aria-busy={loading || fetching || undefined}
              >
                <table className="w-full border-separate border-spacing-0 text-(length:--ms-fs-row)">
                  <thead>
                    <tr>
                      {hasActions ? (
                        <th scope="col" className="sticky top-0 z-10 w-px border-b border-ms-border bg-ms-card pl-5 pr-1 text-left">
                          <Checkbox
                            label="Select all on this page"
                            checked={allSelected}
                            indeterminate={someSelected}
                            onChange={toggleAll}
                            disabled={!rows || rows.length === 0}
                          />
                        </th>
                      ) : null}
                      {columns.map((col, i) => {
                        const keys = sortKeysOf(col);
                        const dir = keys ? (ordering === keys.asc ? "asc" : ordering === keys.desc ? "desc" : null) : null;
                        return (
                          <th
                            key={col.key}
                            scope="col"
                            aria-sort={keys ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
                            className={cn(
                              "sticky top-0 z-10 h-11 whitespace-nowrap border-b border-ms-border bg-ms-card px-3 text-left text-[13px] font-medium text-ms-fg-3",
                              i === 0 && !hasActions && "pl-5",
                              i === columns.length - 1 && "pr-5",
                              col.className,
                            )}
                          >
                            {keys ? (
                              <button
                                type="button"
                                data-dir={dir ?? undefined}
                                onClick={() => go({ o: nextOrdering(keys, ordering) })}
                                className={cn("ms-transition inline-flex items-center gap-1 rounded-[6px] hover:text-ms-fg", dir && "text-ms-fg")}
                              >
                                {col.label}
                                <Icon
                                  name={dir ? "up" : "sort"}
                                  size="sm"
                                  className={cn("ms-transition size-3.5", dir === "desc" && "rotate-180", !dir && "opacity-50")}
                                />
                              </button>
                            ) : (
                              col.label
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !rows ? (
                      Array.from({ length: 8 }, (_, i) => (
                        <tr key={i} data-skeleton>
                          {Array.from({ length: colSpan }, (_, j) => (
                            <td key={j} className={cn("h-(--ms-h-row) border-b border-ms-line px-3", j === 0 && "pl-5")}>
                              <div className="animate-ms-shimmer h-3 rounded-[6px]" style={{ width: j === 0 && hasActions ? 20 : `${[70, 55, 80, 45, 60][(i + j) % 5]}%` }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : !rows || rows.length === 0 ? (
                      <tr>
                        <td colSpan={colSpan}>
                          <EmptyState
                            title={`No ${noun.plural} match`}
                            detail={narrowed ? "Try another search, or clear the filters." : undefined}
                            action={
                              chips.length ? (
                                <Button size="sm" onClick={clearAll}>
                                  Clear filters
                                </Button>
                              ) : undefined
                            }
                          />
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, index) => {
                        const group = groupBy?.(row);
                        const newGroup = group !== undefined && (index === 0 || groupBy?.(rows[index - 1]) !== group);
                        const isSelected = selected.has(row.id);
                        const href = rowHref?.(row);
                        const openRow = href
                          ? (e: MouseEvent<HTMLTableRowElement>) => {
                              // A held modifier asks for a new tab: that is the first cell's link,
                              // never a navigation in place that throws the list away.
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                              markReturn(pathname, row.id);
                              router.push(href);
                            }
                          : onRowClick
                            ? () => onRowClick(row)
                            : undefined;
                        const cell = cn(
                          "h-(--ms-h-row) border-b border-ms-line px-3 py-1.5 align-middle text-ms-fg",
                          isSelected ? "bg-ms-primary-soft" : "group-hover/row:bg-ms-surface",
                          flashLive && flashId === String(row.id) && "animate-ms-flash",
                        );
                        return (
                          <Fragment key={row.id}>
                            {newGroup ? (
                              <tr>
                                <td
                                  colSpan={colSpan}
                                  data-group-header
                                  className="sticky top-11 z-[1] border-b border-ms-border bg-ms-surface px-5 py-1.5 text-[13px] font-semibold text-ms-fg-2"
                                >
                                  {groupLabel ? groupLabel(group!) : group}
                                </td>
                              </tr>
                            ) : null}
                            <tr
                              data-row-id={row.id}
                              onClick={openRow}
                              className={cn("group/row animate-ms-fade-in [&:last-child>td]:border-b-0", openRow && "cursor-pointer")}
                              style={{ animationDelay: `${Math.min(index, 12) * 18}ms` }}
                            >
                              {hasActions ? (
                                <td className={cn(cell, "w-px pl-5 pr-1")} onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    label={`Select ${rowLabel ? rowLabel(row) : row.id}`}
                                    checked={isSelected}
                                    onChange={() => toggleOne(row.id)}
                                  />
                                </td>
                              ) : null}
                              {columns.map((col, i) => (
                                <td
                                  key={col.key}
                                  className={cn(
                                    cell,
                                    "whitespace-nowrap",
                                    i === 0 && !hasActions && "pl-5",
                                    i === columns.length - 1 && "pr-5",
                                    col.className,
                                  )}
                                >
                                  {/* The first column opens the row, as Django links it to the change form —
                                      and gives the keyboard a way in, which a clickable <tr> does not.
                                      With `rowHref` it is a real link: cmd-click and middle-click open
                                      a new tab, and its click stops here so the row does not navigate
                                      a second time. */}
                                  {i === 0 && href ? (
                                    <Link
                                      href={href}
                                      // A page of 50–100 rows would otherwise prefetch every change form on view.
                                      prefetch={false}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        markReturn(pathname, row.id);
                                      }}
                                      className="block max-w-full truncate rounded-[6px] text-left font-semibold text-ms-fg hover:text-ms-primary-text hover:underline"
                                    >
                                      {col.render(row)}
                                    </Link>
                                  ) : i === 0 && onRowClick ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onRowClick(row);
                                      }}
                                      className="block max-w-full truncate rounded-[6px] text-left font-semibold text-ms-fg hover:text-ms-primary-text hover:underline"
                                    >
                                      {col.render(row)}
                                    </button>
                                  ) : (
                                    col.render(row)
                                  )}
                                </td>
                              ))}
                            </tr>
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {mobileCard && !error && (!rows || rows.length === 0) ? (
              <p data-mobile-state className="px-5 py-8 text-center text-[15px] text-ms-fg-2 sm:hidden">
                {loading && !rows ? "Loading…" : `No ${noun.plural} match.`}
              </p>
            ) : null}
            {mobileCard && rows && rows.length > 0 && !error ? (
              <ul className={cn("divide-y divide-ms-line sm:hidden", fetching && "opacity-60")}>
                {rows.map((row, index) => {
                  const group = groupBy?.(row);
                  const newGroup = group !== undefined && (index === 0 || groupBy?.(rows[index - 1]) !== group);
                  return (
                    <Fragment key={row.id}>
                      {newGroup ? (
                        <li className="sticky top-0 z-[1] bg-ms-surface px-5 py-1.5 text-[13px] font-semibold text-ms-fg-2">
                          {groupLabel ? groupLabel(group!) : group}
                        </li>
                      ) : null}
                      <li data-mobile-card>
                        {onRowClick ? (
                          <button type="button" onClick={() => onRowClick(row)} className="ms-transition block w-full px-5 py-3 text-left hover:bg-ms-surface">
                            {mobileCard(row)}
                          </button>
                        ) : (
                          <div className="px-5 py-3">{mobileCard(row)}</div>
                        )}
                      </li>
                    </Fragment>
                  );
                })}
              </ul>
            ) : null}

            {data && !error ? (
              <div className="border-t border-ms-border">
                <Pagination
                  page={page}
                  pages={pages}
                  count={count}
                  // The size the server applied, so "1–25 of 219" counts the rows actually shown.
                  pageSize={data.page_size || params.pageSize}
                  pageSizes={PAGE_SIZES}
                  noun={noun}
                  hrefFor={(p) => hrefFor({ p }, true)}
                  onPage={(p) => go({ p }, true)}
                  onPageSize={(ps) => go({ ps })}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── bulk bar: floats at the bottom of the screen while rows are ticked ── */}
      {bar.mounted ? (
        <div className="pointer-events-none sticky bottom-4 z-30 mt-3 flex justify-center px-4">
          <BulkBar count={selectedIds.length || barCount} closing={bar.closing} onClear={() => setSelected(new Set())}>
            {actions!.map((a) => (
              <button
                key={a.key}
                type="button"
                aria-label={a.label}
                title={a.label}
                disabled={running}
                onClick={() => void runAction(a)}
                className={bulkButtonClass}
              >
                {a.icon ? <Icon name={a.icon} size="sm" /> : null}
                {a.short ?? a.label}
              </button>
            ))}
          </BulkBar>
        </div>
      ) : null}

      {/* ── filters as a side sheet below 1600 px (in a portal: a transformed ancestor would trap `fixed`) ── */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters" className="min-[1600px]:hidden">
        {filterColumn(() => setSheetOpen(false))}
      </Sheet>
    </div>
  );
}

// ─── Filter column ───────────────────────────────────────────────────────────

/** A long group shows its first choices and "Show N more" (the chosen one always shows). */
const GROUP_SHOWN = 6;

function FilterColumn({
  filters,
  active,
  hrefFor,
  onPick,
  trailing,
}: {
  filters: ChangeListFilter[];
  active: Record<string, string>;
  hrefFor: (patch: ChangeListPatch) => string;
  onPick: (patch: ChangeListPatch) => void;
  /** The sheet's heading and close button. */
  trailing?: ReactNode;
}) {
  return (
    <div className="text-[14px]">
      {trailing ? (
        <div className="flex items-center justify-between border-b border-ms-border px-2 pb-3">
          <h2 className="text-[17px] font-semibold text-ms-fg">Filters</h2>
          {trailing}
        </div>
      ) : null}
      {filters.map((f) => (
        <FilterGroup key={f.key} filter={f} current={active[f.key] ?? null} hrefFor={hrefFor} onPick={onPick} />
      ))}
    </div>
  );
}

function FilterGroup({
  filter: f,
  current,
  hrefFor,
  onPick,
}: {
  filter: ChangeListFilter;
  current: string | null;
  hrefFor: (patch: ChangeListPatch) => string;
  onPick: (patch: ChangeListPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const items: Array<{ value: string | null; label: string; count?: number }> = [{ value: null, label: "All" }, ...f.options];
  const shown = open || items.length <= GROUP_SHOWN + 1 ? items : items.filter((it, i) => i < GROUP_SHOWN || it.value === current);
  const hidden = items.length - shown.length;

  return (
    <section className="border-b border-ms-border py-3.5 last:border-b-0">
      <h3 className="px-2 pb-1.5 text-[14px] font-semibold text-ms-fg">{f.label}</h3>
      <ul className="flex flex-col gap-px">
        {shown.map((item) => {
          const on = item.value === current;
          const zero = item.count === 0;
          const patch = { [f.key]: item.value };
          return (
            <li key={item.value ?? "__all"}>
              <a
                href={hrefFor(patch)}
                aria-current={on ? "true" : undefined}
                onClick={(e) => follow(e, () => onPick(patch))}
                className={cn(
                  "ms-transition flex min-h-9 items-center gap-2.5 rounded-[8px] px-2",
                  on
                    ? "bg-ms-primary-soft font-semibold text-ms-primary-text"
                    : zero
                      ? "text-ms-fg-disabled hover:bg-ms-surface-2"
                      : "text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg",
                )}
              >
                {on ? <Icon name="check" size="sm" className="shrink-0" /> : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.count !== undefined ? (
                  <span className={cn("shrink-0 text-[13px] font-medium tabular-nums", on ? "text-ms-primary-text" : zero ? "text-ms-fg-disabled" : "text-ms-fg-3")}>
                    {item.count.toLocaleString("en-US")}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ms-press mt-px flex min-h-9 w-full items-center rounded-[8px] px-2 text-left font-semibold text-ms-primary-text hover:bg-ms-surface-2"
        >
          Show {hidden} more
        </button>
      ) : null}
    </section>
  );
}
