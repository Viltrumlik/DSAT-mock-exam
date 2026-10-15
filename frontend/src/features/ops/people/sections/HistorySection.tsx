"use client";

import { Fieldset, PartBody } from "../Fieldset";
import { formatDateTime, formatDay } from "../format";
import { usePersonPart, type PersonHistory } from "../personApi";

/**
 * What happened to the account, newest first: role changes, seats, security and admin events,
 * lc-up payments. Admin edits were not recorded before this page shipped.
 */

const time = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export function HistorySection({ id }: { id: number }) {
  const query = usePersonPart<PersonHistory>(id, "history");
  return (
    <Fieldset title="History">
      <PartBody
        query={query}
        isEmpty={(d) => d.items.length === 0}
        render={(d) => {
          const items = [...d.items].sort((a, b) => time(b.at) - time(a.at));
          return (
            <>
              <ol className="space-y-0.5">
                {items.map((item, i) => (
                  <li key={`${item.at}-${i}`} className="break-words">
                    <span className="tabular-nums text-muted-foreground">
                      {/* A payment has a day, not a time: its "at" is that day's midnight, read as the day. */}
                      {item.all_day ? formatDay(item.at.slice(0, 10)) : formatDateTime(item.at)}
                    </span>
                    {" · "}
                    {item.title}
                    {item.by ? <span className="text-muted-foreground"> · by {item.by}</span> : null}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">
                Admin edits are recorded from 15 Oct 2026.
                {d.truncated ? " Showing the latest 200." : null}
              </p>
            </>
          );
        }}
      />
    </Fieldset>
  );
}
