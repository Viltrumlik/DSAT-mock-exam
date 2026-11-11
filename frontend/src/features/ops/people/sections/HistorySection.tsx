"use client";

import { History } from "lucide-react";
import { Fieldset, PartBody } from "../Fieldset";
import { HistoryTimeline } from "../graphics";
import { usePersonPart, type PersonHistory } from "../personApi";

/**
 * What happened to the account, newest first, as the console's timeline (DataDisplay board): each event's
 * icon in the tone of its kind, who did it and when, and chips that count and filter by kind (money, seat,
 * security, admin). Admin edits were not recorded before this page shipped.
 */
export function HistorySection({ id }: { id: number }) {
  const query = usePersonPart<PersonHistory>(id, "history");
  return (
    <Fieldset title="History" icon={History} tone="neutral" description="Admin edits are recorded from 15 Oct 2026.">
      <PartBody
        query={query}
        isEmpty={(d) => d.items.length === 0}
        render={(d) => (
          <>
            <HistoryTimeline items={d.items} />
            {d.truncated ? <p className="mt-3 text-xs text-ms-fg-3">Showing the latest 200.</p> : null}
          </>
        )}
      />
    </Fieldset>
  );
}
