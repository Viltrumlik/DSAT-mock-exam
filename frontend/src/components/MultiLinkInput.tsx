"use client";

import { Link2, Plus, X } from "lucide-react";

export interface MultiLinkInputProps {
  /** Current links. May contain blank rows while the user is typing. */
  value: string[];
  onChange: (links: string[]) => void;
  /** Input class from the caller so the control matches its surrounding form. */
  inputClassName?: string;
  placeholder?: string;
  /** Stable id prefix for the individual row inputs. */
  idPrefix?: string;
}

/**
 * Repeatable list of external links. A homework brief / classwork block can carry several
 * links instead of one; the parent keeps the raw array (blanks and all) and trims + filters
 * on save. Always shows at least one row so the control is visible.
 */
export default function MultiLinkInput({
  value,
  onChange,
  inputClassName = "",
  placeholder = "https://example.com/resource",
  idPrefix = "link",
}: MultiLinkInputProps) {
  const rows = value.length > 0 ? value : [""];

  const setAt = (i: number, v: string) => {
    const next = rows.slice();
    next[i] = v;
    onChange(next);
  };
  const removeAt = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, ""]);

  return (
    <div className="space-y-2">
      {rows.map((link, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
            <input
              id={`${idPrefix}-${i}`}
              type="url"
              value={link}
              onChange={(e) => setAt(i, e.target.value)}
              placeholder={placeholder}
              className={`${inputClassName} pl-10`}
            />
          </div>
          {(rows.length > 1 || link.trim().length > 0) && (
            <button
              type="button"
              aria-label="Remove link"
              onClick={() => removeAt(i)}
              className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
