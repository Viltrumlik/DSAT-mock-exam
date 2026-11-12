"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { BankQuestionEditor } from "@/domains/questionBank/components/BankQuestionEditor";
import { buttonClass } from "@/features/console/ui";

/** A question written by hand (design handoff v0.3, PR 16a): the bank's editor under the Builder's header. */
export default function NewBankQuestionPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-5">
      <Link href="/builder/question-bank" className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-2 self-start" })}>
        <Icon name="left" size="sm" /> Back to Question Bank
      </Link>
      <header className="animate-ms-fade-in">
        <p className="text-ms-over mb-1.5 uppercase text-ms-primary-text">Question bank</p>
        <h1 className="font-ms-display text-ms-b-display text-ms-fg">New question</h1>
        <p className="mt-1 max-w-2xl text-[14px] text-ms-fg-2">
          Author a question by hand. It lands in triage; classify and approve it to make it selectable.
        </p>
      </header>
      <BankQuestionEditor onSaved={(q) => router.push(`/builder/question-bank/${q.id}`)} />
    </div>
  );
}
