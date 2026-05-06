"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Construction, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { getQuestionsConsoleOrigin } from "@/lib/questionsConsoleOrigin";

export default function QuestionBankStubPage() {
  const origin = useMemo(() => getQuestionsConsoleOrigin(), []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/12 ring-1 ring-primary/25">
        <Construction className="h-8 w-8 text-primary" />
      </div>
      <Badge variant="neutral" className="mt-6">
        Under construction
      </Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">Question bank</h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        Authoring and editing questions live on the dedicated{" "}
        <span className="font-semibold text-foreground">questions console</span>. In-product browsing from the main LMS
        site is coming soon.
      </p>
      {origin ? (
        <Link
          href={origin}
          className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:opacity-95"
        >
          Open questions console
          <ExternalLink className="h-4 w-4 opacity-90" />
        </Link>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">
          Ask your administrator for the authoring URL, or set{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_QUESTIONS_CONSOLE_ORIGIN</code> in
          the frontend environment.
        </p>
      )}
    </div>
  );
}
