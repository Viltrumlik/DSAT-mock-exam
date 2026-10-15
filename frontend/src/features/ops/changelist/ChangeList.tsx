"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { PAGE_SIZES, useChangeListParams, type ChangeListPatch } from "./useChangeListParams";

/**
 * A list page after Django admin's changelist: title and count, a search box, "Action: [ ] Go",
 * a dense sortable table, a filter panel on the right with a count beside every choice, and
 * pages underneath. The state lives in the address (useChangeListParams); the data comes from
 * the page's own query, so this renders whatever list it is handed.
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
  label: string;
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
  /** A button beside the title, e.g. "Add student". */
  headerAction?: ReactNode;
  searchPlaceholder?: string;
  /** Names a row for its checkbox's label; defaults to the id. */
  rowLabel?: (row: R) => string;
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

/** "1 2 3 … 9": the ends, and the current page with one either side. */
export function pageWindow(page: number, pages: number): Array<number | "…"> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = [...new Set([1, pages, page - 1, page, page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  keep.forEach((n, i) => {
    const prev = keep[i - 1];
    if (prev !== undefined && n - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) out.push("…");
    out.push(n);
  });
  return out;
}

/** A plain click goes through the router; a modified click opens the link the browser's way. */
function follow(e: MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}

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
}: ChangeListProps<R>) {
  const router = useRouter();
  const { params, queryString, hrefFor, update } = useChangeListParams(filterKeys);
  const rows = data?.results;
  const filters = data?.filters ?? [];
  const active = params.filters;
  const activeCount = Object.keys(active).length;
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

  // ── Actions bar ──
  const [actionKey, setActionKey] = useState("");
  const [running, setRunning] = useState(false);
  const runAction = async () => {
    const action = actions?.find((a) => a.key === actionKey);
    if (!action || selectedIds.length === 0) return;
    setRunning(true);
    try {
      const done = await action.run(selectedIds);
      if (done === true) {
        setSelected(new Set());
        setActionKey("");
      }
    } finally {
      setRunning(false);
    }
  };

  // ── Filters drawer (below xl) ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const go = (patch: ChangeListPatch, keepPage = false) => update(patch, keepPage);
  const colSpan = columns.length + (hasActions ? 1 : 0);
  const count = data?.count ?? 0;
  const page = data?.page ?? params.page;
  const pages = data?.pages ?? 1;

  const filterPanel = (onPicked?: () => void, trailing?: ReactNode) => (
    <FilterPanel
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
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="text-lg font-semibold text-foreground">
          {title}
          {data ? (
            <span className="font-normal text-muted-foreground tabular-nums"> · {count.toLocaleString("en-US")}</span>
          ) : null}
        </h1>
        {headerAction ? <div className="ml-auto">{headerAction}</div> : null}
      </header>

      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <SearchBox
              value={params.q}
              placeholder={searchPlaceholder ?? `Search ${noun.plural}`}
              onSearch={(q) => go({ q })}
            />
            {filters.length > 0 ? (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-expanded={drawerOpen}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary xl:hidden"
              >
                <SlidersHorizontal aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                Filters
                {activeCount > 0 ? <span className="tabular-nums text-muted-foreground">({activeCount})</span> : null}
              </button>
            ) : null}
          </div>

          {hasActions ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <label htmlFor="changelist-action" className="text-muted-foreground">
                Action:
              </label>
              <select
                id="changelist-action"
                value={actionKey}
                onChange={(e) => setActionKey(e.target.value)}
                className="h-7 rounded-md border border-border bg-card px-1.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">---------</option>
                {actions!.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void runAction()}
                disabled={!actionKey || selectedIds.length === 0 || running}
                className="h-7 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Go
              </button>
              <span className="tabular-nums text-muted-foreground" aria-live="polite">
                {selectedIds.length} of {rows?.length ?? 0} selected
              </span>
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="border border-border bg-card px-3 py-4 text-[13px] text-foreground">
              Couldn&apos;t load {noun.plural}.{" "}
              <button
                type="button"
                onClick={onRetry}
                className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Retry
              </button>
            </div>
          ) : (
            <div
              className={cn(
                // Its own scroll pane from md up, so the header row can stick while the rows scroll
                // (a sticky header cannot stick to the page through a horizontal-scroll wrapper).
                "overflow-x-auto border border-border bg-card transition-opacity md:max-h-[calc(100dvh-15rem)] md:overflow-y-auto",
                fetching && "opacity-60",
              )}
              aria-busy={loading || fetching || undefined}
            >
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    {hasActions ? (
                      <th scope="col" className="sticky top-0 z-10 w-8 border-b border-border bg-card px-2 text-left">
                        <input
                          type="checkbox"
                          aria-label="Select all on this page"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={toggleAll}
                          disabled={!rows || rows.length === 0}
                          className="h-3.5 w-3.5 cursor-pointer align-middle accent-primary"
                        />
                      </th>
                    ) : null}
                    {columns.map((col) => {
                      const keys = sortKeysOf(col);
                      const dir = keys ? (ordering === keys.asc ? "asc" : ordering === keys.desc ? "desc" : null) : null;
                      return (
                        <th
                          key={col.key}
                          scope="col"
                          aria-sort={keys ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
                          className={cn(
                            "sticky top-0 z-10 h-8 whitespace-nowrap border-b border-border bg-card px-2 text-left text-[12px] font-semibold text-muted-foreground",
                            col.className,
                          )}
                        >
                          {keys ? (
                            <button
                              type="button"
                              onClick={() => go({ o: nextOrdering(keys, ordering) })}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                dir && "text-foreground",
                              )}
                            >
                              {col.label}
                              <span aria-hidden className="text-[10px]">
                                {dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}
                              </span>
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
                          <td key={j} className="h-[34px] border-b border-border px-2">
                            <div className="h-2.5 w-full max-w-[8rem] animate-pulse rounded-sm bg-surface-2" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : !rows || rows.length === 0 ? (
                    <tr>
                      <td colSpan={colSpan} className="px-2 py-6 text-muted-foreground">
                        No {noun.plural} match.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const isSelected = selected.has(row.id);
                      const href = rowHref?.(row);
                      const openRow = href
                        ? (e: MouseEvent<HTMLTableRowElement>) => {
                            // A held modifier asks for a new tab: that is the first cell's link,
                            // never a navigation in place that throws the list away.
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                            router.push(href);
                          }
                        : onRowClick
                          ? () => onRowClick(row)
                          : undefined;
                      return (
                        <tr
                          key={row.id}
                          onClick={openRow}
                          className={cn(
                            "[&:last-child>td]:border-b-0",
                            openRow && "cursor-pointer",
                            isSelected ? "bg-primary-soft" : "hover:bg-surface-2",
                          )}
                        >
                          {hasActions ? (
                            <td className="h-[34px] w-8 border-b border-border px-2" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`Select ${rowLabel ? rowLabel(row) : row.id}`}
                                checked={isSelected}
                                onChange={() => toggleOne(row.id)}
                                className="h-3.5 w-3.5 cursor-pointer align-middle accent-primary"
                              />
                            </td>
                          ) : null}
                          {columns.map((col, i) => (
                            <td
                              key={col.key}
                              className={cn("h-[34px] whitespace-nowrap border-b border-border px-2 text-foreground", col.className)}
                            >
                              {/* The first column opens the row, as Django links it to the change form —
                                  and gives the keyboard a way in, which a clickable <tr> does not.
                                  With `rowHref` it is a real link: cmd-click and middle-click open
                                  a new tab, and its click stops here so the row does not navigate
                                  a second time. */}
                              {i === 0 && href ? (
                                <Link
                                  href={href}
                                  onClick={(e) => e.stopPropagation()}
                                  className="block max-w-full truncate rounded-sm text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-hover"
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
                                  className="block max-w-full truncate rounded-sm text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-hover"
                                >
                                  {col.render(row)}
                                </button>
                              ) : (
                                col.render(row)
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {data && !error ? (
            <Pagination
              page={page}
              pages={pages}
              count={count}
              pageSize={params.pageSize}
              noun={noun}
              hrefFor={hrefFor}
              onPage={(p) => go({ p }, true)}
              onPageSize={(ps) => go({ ps })}
            />
          ) : null}
        </div>

        {filters.length > 0 ? (
          <aside aria-label="Filters" className="hidden w-56 shrink-0 border border-border bg-card xl:block">
            {filterPanel()}
          </aside>
        ) : null}
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close filters"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-[var(--overlay-scrim)]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            className="absolute inset-y-0 right-0 w-72 max-w-[85vw] overflow-y-auto border-l border-border bg-card"
          >
            {filterPanel(
              () => setDrawerOpen(false),
              <button
                type="button"
                autoFocus
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
                className="-mr-1.5 grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-4 w-4" />
              </button>,
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Searches 300 ms after typing stops, or at once on Enter. */
function SearchBox({ value, placeholder, onSearch }: { value: string; placeholder: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  // What was last sent to the address — so the address catching up with our own search does not
  // overwrite what has been typed since, while back/forward (a different value) still does.
  const committed = useRef(value);
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setText(value);
  }, [value]);

  const commit = (raw: string) => {
    const next = raw.trim();
    if (next === committed.current) return;
    committed.current = next;
    onSearchRef.current(next);
  };

  useEffect(() => {
    if (text.trim() === committed.current) return;
    const t = window.setTimeout(() => commit(text), 300);
    return () => window.clearTimeout(t);
  }, [text]);

  return (
    <form
      role="search"
      className="relative w-full max-w-sm"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        commit(text);
      }}
    >
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
    </form>
  );
}

// ─── Filters ─────────────────────────────────────────────────────────────────

function FilterPanel({
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
  /** Beside the heading — the drawer's close button. */
  trailing?: ReactNode;
}) {
  const anyActive = filters.some((f) => active[f.key]);
  const clearAll: ChangeListPatch = Object.fromEntries(filters.map((f) => [f.key, null]));

  return (
    <div className="text-[13px]">
      <div className="flex min-h-10 items-center gap-2 border-b border-border px-3 py-1.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Filter</h2>
        {anyActive ? (
          <a
            href={hrefFor(clearAll)}
            onClick={(e) => follow(e, () => onPick(clearAll))}
            className="ml-auto text-[12px] text-primary hover:underline dark:text-primary-hover"
          >
            Clear all filters
          </a>
        ) : null}
        {trailing ? <div className={anyActive ? undefined : "ml-auto"}>{trailing}</div> : null}
      </div>
      {filters.map((f) => {
        const current = active[f.key] ?? null;
        const items: Array<{ value: string | null; label: string; count?: number }> = [
          { value: null, label: "All" },
          ...f.options,
        ];
        return (
          <section key={f.key} className="border-b border-border px-3 py-2 last:border-b-0">
            <h3 className="mb-1 text-[12px] font-semibold text-foreground">By {f.label.toLowerCase()}</h3>
            <ul className="space-y-px">
              {items.map((item) => {
                const on = item.value === current;
                const patch = { [f.key]: item.value };
                return (
                  <li key={item.value ?? "__all"}>
                    <a
                      href={hrefFor(patch)}
                      aria-current={on ? "true" : undefined}
                      onClick={(e) => follow(e, () => onPick(patch))}
                      className={cn(
                        "flex items-baseline justify-between gap-2 rounded-sm px-1.5 py-0.5 hover:bg-surface-2",
                        on ? "font-semibold text-foreground" : "text-primary dark:text-primary-hover",
                      )}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.count !== undefined ? (
                        <span className="shrink-0 font-normal tabular-nums text-muted-foreground">{item.count}</span>
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ─── Pagination ──────────────────────────────────────────────────────────────

function Pagination({
  page,
  pages,
  count,
  pageSize,
  noun,
  hrefFor,
  onPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  count: number;
  pageSize: number;
  noun: { singular: string; plural: string };
  hrefFor: (patch: ChangeListPatch, keepPage?: boolean) => string;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const link = "grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-primary hover:bg-surface-2 dark:text-primary-hover";
  const pageLink = (p: number, label: ReactNode, aria?: string) => (
    <a href={hrefFor({ p }, true)} aria-label={aria} onClick={(e) => follow(e, () => onPage(p))} className={link}>
      {label}
    </a>
  );

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
      {pages > 1 ? (
        <div className="flex items-center gap-0.5">
          {page > 1 ? pageLink(page - 1, "‹", "Previous page") : <span aria-hidden className={cn(link, "text-muted-foreground opacity-40 hover:bg-transparent")}>‹</span>}
          {pageWindow(page, pages).map((n, i) =>
            n === "…" ? (
              <span key={`gap-${i}`} aria-hidden className="px-1 text-muted-foreground">
                …
              </span>
            ) : n === page ? (
              <span key={n} aria-current="page" className="grid h-7 min-w-7 place-items-center rounded-md border border-border px-1.5 font-semibold text-foreground">
                {n}
              </span>
            ) : (
              <span key={n}>{pageLink(n, n, `Page ${n}`)}</span>
            ),
          )}
          {page < pages ? pageLink(page + 1, "›", "Next page") : <span aria-hidden className={cn(link, "text-muted-foreground opacity-40 hover:bg-transparent")}>›</span>}
        </div>
      ) : null}
      <span className="tabular-nums text-muted-foreground">
        {count.toLocaleString("en-US")} {count === 1 ? noun.singular : noun.plural}
      </span>
      <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
        Per page
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="h-7 rounded-md border border-border bg-card px-1.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
