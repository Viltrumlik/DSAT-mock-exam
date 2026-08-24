"use client";

/**
 * The admin console's page header, in one place.
 *
 * The console had drifted into two dialects. Most pages — Users, Classrooms, Exam dates,
 * Surveys, Assignments — open with a small primary-coloured eyebrow, an `text-xl font-bold`
 * title and a muted one-line description. The pages added later — Support, Shop, Branches,
 * Stories, Journals — opened with a bare `text-2xl font-extrabold` title and no eyebrow. Side
 * by side in the same sidebar they read as two different products, and the eyebrow is not
 * decoration: it is the only thing on the page that says which console you are in.
 *
 * The older dialect wins because it is the majority and because it carries more information,
 * not because it is older. This component is that dialect, so the next page added has one
 * obvious thing to reach for instead of a choice between two precedents.
 *
 * Deliberately just the header. The pages that adopt it keep their own structure, their own
 * cards and their own content — this changes what they look like at the top, not how they
 * work.
 */

import type { ReactNode } from "react";

export function OpsPageHeader({
  section,
  title,
  description,
  actions,
}: {
  /** The eyebrow's second half — rendered as "Admin console · {section}". */
  section: string;
  title: string;
  description?: ReactNode;
  /** Buttons for the top-right. Omitted on pages that have nothing to put there. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      {/* min-w-0 so a long description wraps instead of pushing the actions off the row. */}
      <div className="min-w-0">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">
          Admin console · {section}
        </p>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export default OpsPageHeader;
