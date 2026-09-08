"use client";

import { ChevronDown } from "lucide-react";
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
    <details className="group rounded-2xl border border-border bg-surface-2 px-4 py-3">
      <summary className="ds-ring flex cursor-pointer list-none items-start gap-2 text-[13px] leading-relaxed text-muted-foreground marker:content-['']">
        <ChevronDown
          className="mt-0.5 h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
        <span>
          {definitionLine(definition)}{" "}
          <span className="font-bold text-foreground underline decoration-dotted underline-offset-2">
            What these numbers mean
          </span>
        </span>
      </summary>

      {entries.length > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-border pt-3 text-[13px] sm:grid-cols-[minmax(0,220px)_1fr]">
          {entries.map((e) => (
            <div key={e.key} className="contents">
              <dt className="font-bold text-foreground">{e.label}</dt>
              <dd className="text-muted-foreground">{e.text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-[13px] text-muted-foreground">
          The server did not send a definition block with this response, so only the summary
          above is available.
        </p>
      )}
    </details>
  );
}
