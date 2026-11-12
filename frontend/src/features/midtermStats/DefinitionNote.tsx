"use client";

import { Icon } from "@/components/ui/Icon";
import { definitionEntries, definitionLine } from "./format";
import type { StatsDefinition } from "./types";

/**
 * What this page measured, in the page's own words.
 *
 * These figures are read to judge teachers. A percentage with no stated rule invites every
 * reader to supply their own — "of the students who turned up", "of those who sat both
 * papers", "averaged across the classes" are all different numbers wearing the same name —
 * so the rule is on the page, not in a handbook.
 *
 * The sentence is built from the `definition` block the backend sends with every payload
 * rather than written here, so the page cannot end up describing a rule the aggregation
 * stopped applying.
 */
export function DefinitionNote({ definition }: { definition: StatsDefinition | undefined }) {
  const entries = definitionEntries(definition);
  return (
    <details className="group rounded-ms-card border border-ms-border bg-ms-surface px-4 py-3">
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-[6px] text-[13px] leading-[19px] text-ms-fg-2 marker:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring">
        <Icon name="down" size="sm" className="mt-0.5 text-ms-fg-3 transition-[rotate] duration-200 group-open:rotate-180 motion-reduce:transition-none" />
        <span>
          {definitionLine(definition)}{" "}
          <span className="font-semibold text-ms-primary-text underline decoration-dotted underline-offset-2">
            What these numbers mean
          </span>
        </span>
      </summary>

      {entries.length > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-ms-line pt-3 text-[13px] leading-[19px] sm:grid-cols-[minmax(0,220px)_1fr]">
          {entries.map((e) => (
            <div key={e.key} className="contents">
              <dt className="font-semibold text-ms-fg">{e.label}</dt>
              <dd className="text-ms-fg-2">{e.text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 border-t border-ms-line pt-3 text-[13px] text-ms-fg-2">
          The server did not send a definition block with this response, so only the summary
          above is available.
        </p>
      )}
    </details>
  );
}
