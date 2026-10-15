"use client";

import { History } from "lucide-react";
import { cn } from "@/lib/cn";
import { Fieldset, PartBody } from "../Fieldset";
import { formatDateTime, formatDay } from "../format";
import { usePersonPart, type PersonHistory } from "../personApi";

/**
 * What happened to the account, newest first, on a timeline: a dot per event in the colour of its
 * kind (a role change, a seat, an admin's action, a security event, a payment), so a long history
 * can be scanned for the kind wanted. Admin edits were not recorded before this page shipped.
 */

const KIND: Record<PersonHistory["items"][number]["kind"], { dot: string; label: string }> = {
  role: { dot: "bg-accent", label: "Role" },
  group: { dot: "bg-primary", label: "Group" },
  admin: { dot: "bg-warning", label: "Admin" },
  security: { dot: "bg-muted-foreground", label: "Security" },
  payment: { dot: "bg-success", label: "Payment" },
};

const time = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export function HistorySection({ id }: { id: number }) {
  const query = usePersonPart<PersonHistory>(id, "history");
  return (
    <Fieldset
      title="History"
      icon={History}
      tone="neutral"
      description="Admin edits are recorded from 15 Oct 2026."
      right={
        <ul aria-label="Kinds" className="hidden flex-wrap items-center gap-3 text-xs text-muted-foreground sm:flex">
          {Object.values(KIND).map((k) => (
            <li key={k.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("h-2 w-2 rounded-full", k.dot)} />
              {k.label}
            </li>
          ))}
        </ul>
      }
    >
      <PartBody
        query={query}
        isEmpty={(d) => d.items.length === 0}
        render={(d) => {
          const items = [...d.items].sort((a, b) => time(b.at) - time(a.at));
          return (
            <>
              <ol className="ml-1.5 border-l border-border">
                {items.map((item, i) => {
                  const kind = KIND[item.kind] ?? KIND.security;
                  return (
                    <li key={`${item.at}-${i}`} className="relative break-words py-2 pl-6">
                      <span
                        aria-hidden
                        title={kind.label}
                        className={cn("absolute -left-[5px] top-[15px] h-2.5 w-2.5 rounded-full ring-4 ring-card", kind.dot)}
                      />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {/* A payment has a day, not a time: its "at" is that day's midnight, read as the day. */}
                        {item.all_day ? formatDay(item.at.slice(0, 10)) : formatDateTime(item.at)}
                      </span>
                      {" · "}
                      <span className="font-medium text-foreground">{item.title}</span>
                      {item.by ? <span className="text-muted-foreground"> · by {item.by}</span> : null}
                    </li>
                  );
                })}
              </ol>
              {d.truncated ? <p className="mt-3 text-xs text-muted-foreground">Showing the latest 200.</p> : null}
            </>
          );
        }}
      />
    </Fieldset>
  );
}
