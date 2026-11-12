"use client";

import { Icon } from "@/components/ui/Icon";
import { buttonClass } from "@/features/console/ui";

const TEACHER_PORTAL_URL = process.env.NEXT_PUBLIC_TEACHER_PORTAL_URL || "https://teacher.mastersat.uz";

// Operational assignment management was moved to the Teacher Portal as part of Admin
// Simplification. Admin/Ops is governance-only and no longer creates/edits/deletes
// classroom assignments. (Midterm/assessment authoring remains under their own admin tools.)
//
// In the console's look (design handoff v0.3): a card that says where the work went, and the way
// there as the console's primary button. The words and the link are the page's own.
export default function OpsAssignmentsMovedPage() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <div className="animate-ms-card-in flex flex-col items-center rounded-ms-card bg-ms-card px-6 py-10 text-center shadow-ms-1">
        <span className="mb-4 grid size-12 place-items-center rounded-full bg-ms-surface-2 text-ms-fg-3">
          <Icon name="clipboard" size="xl" />
        </span>
        <h1 className="text-ms-title text-ms-fg">Assignments moved to the Teacher Portal</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-[23px] text-ms-fg-2">
          Teachers now create and manage classroom assignments (homework, assessments, past papers,
          midterms) directly in their classroom workspace. Admin is governance-only.
        </p>
        <a href={`${TEACHER_PORTAL_URL}/teacher/classrooms`} className={buttonClass({ variant: "primary", className: "mt-6" })}>
          Open Teacher Portal <Icon name="external" size="sm" />
        </a>
      </div>
    </div>
  );
}
