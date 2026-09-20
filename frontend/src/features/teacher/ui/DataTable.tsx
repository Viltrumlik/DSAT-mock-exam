"use client";

import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Figures read right-aligned; words read left. */
  align?: "left" | "right";
  width?: number | string;
  render: (row: T) => ReactNode;
};

/**
 * The dense list. This look has no table of its own — the student side has few of them — and a
 * teacher reads lists all day, so the card idiom (shadow, lift, 24px corners per row) is too
 * heavy here. Same palette, same face, lighter weight: hairline separators, a sticky header,
 * 40px rows, no hover lift.
 *
 * Rows carry their own empty case: `empty` renders INSTEAD of a headed table with no body, so a
 * class with nobody in it never looks like a table that failed to load.
 */
export function DataTable<T>({ columns, rows, rowKey, empty, onRowClick, label }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  label?: string;
}) {
  if (rows.length === 0 && empty != null) return <>{empty}</>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        aria-label={label}
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, color: "var(--dz-ink)" }}
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{
                  position: "sticky", top: 0, zIndex: 1,
                  textAlign: c.align === "right" ? "right" : "left",
                  width: c.width, whiteSpace: "nowrap",
                  padding: "0 12px 8px", background: "var(--dz-card)",
                  fontSize: 12, fontWeight: 700, letterSpacing: ".04em",
                  textTransform: "uppercase", color: "var(--dz-faint)",
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ borderTop: "1px solid var(--dz-border)", cursor: onRowClick ? "pointer" : undefined }}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    height: 40, padding: "0 12px", verticalAlign: "middle",
                    textAlign: c.align === "right" ? "right" : "left",
                    fontWeight: c.align === "right" ? 700 : 500,
                    // A cell keeps its line. On a phone a four-column table would otherwise
                    // break every class name over three lines; the container scrolls instead,
                    // which is the readable way to lose a column edge rather than a word.
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
