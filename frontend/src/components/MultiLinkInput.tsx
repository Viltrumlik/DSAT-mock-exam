"use client";

import { Link2, Plus, Tag, X } from "lucide-react";

/** One row of the control: the link itself and the optional name shown in its place. */
export interface LinkRow {
  url: string;
  /** What a student sees instead of the raw URL. Blank is normal — then they see the URL. */
  label: string;
}

export interface MultiLinkInputProps {
  /** Current links. May contain blank rows while the user is typing. */
  value: LinkRow[];
  onChange: (links: LinkRow[]) => void;
  /** Input class from the caller so the control matches its surrounding form. */
  inputClassName?: string;
  placeholder?: string;
  /** Stable id prefix for the individual row inputs. */
  idPrefix?: string;
}

/** A name is a label, not prose — the server truncates at the same length. */
export const LINK_LABEL_MAX = 120;

/** `["a.com"]` / parallel name list from anywhere → the row shape this control edits. */
export function toLinkRows(urls?: string[] | null, labels?: string[] | null): LinkRow[] {
  return (urls ?? []).map((url, i) => ({ url, label: labels?.[i] ?? "" }));
}

/** Rows → the two index-aligned lists the API takes. Blank links (and their names) drop out. */
export function fromLinkRows(rows: LinkRow[]): { urls: string[]; labels: string[] } {
  const kept = rows.filter((r) => r.url.trim().length > 0);
  return {
    urls: kept.map((r) => r.url.trim()),
    labels: kept.map((r) => r.label.trim()),
  };
}

/**
 * Repeatable list of external links, each with an optional name. A homework brief /
 * classwork block can carry several links instead of one; the parent keeps the raw array
 * (blanks and all) and trims + filters on save via `fromLinkRows`.
 *
 * The name sits BESIDE its link rather than under it: the two belong to one row, and a
 * stacked pair reads as two separate fields once there are three or four links. It stays
 * optional — an unnamed link is shown as the link, which is what every link did before
 * names existed. Always shows at least one row so the control is visible.
 */
export default function MultiLinkInput({
  value,
  onChange,
  inputClassName = "",
  placeholder = "https://example.com/resource",
  idPrefix = "link",
}: MultiLinkInputProps) {
  const rows: LinkRow[] = value.length > 0 ? value : [{ url: "", label: "" }];

  const setAt = (i: number, patch: Partial<LinkRow>) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeAt = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { url: "", label: "" }]);

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
              <input
                id={`${idPrefix}-${i}`}
                type="url"
                value={row.url}
                onChange={(e) => setAt(i, { url: e.target.value })}
                placeholder={placeholder}
                className={`${inputClassName} pl-10`}
              />
            </div>
            <div className="relative sm:w-52">
              <Tag className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
              <input
                id={`${idPrefix}-${i}-name`}
                type="text"
                value={row.label}
                maxLength={LINK_LABEL_MAX}
                onChange={(e) => setAt(i, { label: e.target.value })}
                placeholder="Name (optional)"
                aria-label="Link name"
                className={`${inputClassName} pl-10`}
              />
            </div>
          </div>
          {(rows.length > 1 || row.url.trim().length > 0 || row.label.trim().length > 0) && (
            <button
              type="button"
              aria-label="Remove link"
              onClick={() => removeAt(i)}
              className="mt-1 shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
      >
        <Plus className="h-3.5 w-3.5" /> Add another link
      </button>
    </div>
  );
}
