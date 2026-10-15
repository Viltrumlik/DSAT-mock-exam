"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { BankQuestionEditor } from "@/domains/questionBank/components/BankQuestionEditor";

export default function NewBankQuestionPage() {
  const router = useRouter();
  return (
    <div className="space-y-5">
      <Link
        href="/builder/question-bank"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Question Bank
      </Link>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">New question</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Author a question by hand. It lands in triage; classify and approve it to make it selectable.
        </p>
      </div>
      <BankQuestionEditor onSaved={(q) => router.push(`/builder/question-bank/${q.id}`)} />
    </div>
  );
}
