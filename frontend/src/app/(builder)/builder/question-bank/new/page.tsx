"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { BankQuestionEditor } from "@/domains/questionBank/components/BankQuestionEditor";
import {
  STUDIO_LINK,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
  STUDIO_SECTION_GAP,
} from "@/components/studio/primitives";

export default function NewBankQuestionPage() {
  const router = useRouter();
  return (
    <div className={STUDIO_SECTION_GAP}>
      <Link href="/builder/question-bank" className={`${STUDIO_LINK} inline-flex items-center gap-1 text-[13px]`}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Question Bank
      </Link>
      <div>
        <h1 className={STUDIO_PAGE_TITLE}>New question</h1>
        <p className={STUDIO_PAGE_DESC}>
          Author a question by hand. It lands in triage; classify and approve it to make it selectable.
        </p>
      </div>
      <BankQuestionEditor onSaved={(q) => router.push(`/builder/question-bank/${q.id}`)} />
    </div>
  );
}
