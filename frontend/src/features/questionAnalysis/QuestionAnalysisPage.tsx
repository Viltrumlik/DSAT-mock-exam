"use client";

import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ClipboardCheck, School } from "lucide-react";
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Select,
  Tabs,
} from "@/features/classroom/ui";
import { normalizeApiError } from "@/lib/apiError";
import { AssessmentsPanel } from "./AssessmentsPanel";
import { PastPapersPanel } from "./PastPapersPanel";
import { questionAnalysisApi, questionAnalysisKeys } from "./api";
import { DEFAULT_THRESHOLD, subjectLabel } from "./format";
import { ThresholdControl } from "./components/ThresholdControl";

type TabId = "assessments" | "pastpapers";

const TABS = [
  { id: "assessments", label: "Assessments", icon: ClipboardCheck },
  { id: "pastpapers", label: "Past papers", icon: BookOpen },
];

/**
 * The teacher's answer to "which questions do I need to go back over?"
 *
 * The school owner's rule is the whole brief: a question a quarter or more of the class got
 * wrong is work, on assessments and on past papers alike, and past papers additionally have
 * to break down by question type so a teacher can tell a topic problem from a question
 * problem. So the page is a work list first — flagged questions, worst first, each carrying
 * enough context to act on without another click — with the full picture kept below it.
 *
 * The classroom picker and the threshold live here because both tabs answer to them; the
 * set and paper pickers live inside their own tab because neither means anything in the other.
 */
export function QuestionAnalysisPage() {
  const [classroomId, setClassroomId] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [tab, setTab] = useState<TabId>("assessments");
  const classroomSelectId = useId();
  const thresholdInputId = useId();

  const classroomsQuery = useQuery({
    queryKey: questionAnalysisKeys.classrooms(),
    queryFn: () => questionAnalysisApi.classrooms(),
  });

  const classrooms = classroomsQuery.data;

  // Land on a class rather than an "choose one" prompt: a teacher with one classroom should
  // never have to pick it, and the pickers stay visible either way.
  useEffect(() => {
    if (classroomId != null || !classrooms || classrooms.length === 0) return;
    setClassroomId(classrooms[0].id);
  }, [classrooms, classroomId]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        title="Question analysis"
        // One line, not three: the school's rule is restated beside the threshold control and
        // again over the flagged list, and every line here pushed the work list further down.
        description="The questions your class missed often enough to be worth a lesson."
      />

      <Card className="space-y-4">
        {/* Four branches on the classroom list too — a failed fetch here must not read as
            "you teach no classes". */}
        {classroomsQuery.isError ? (
          <ErrorState
            title="We could not load your classrooms."
            message={`${normalizeApiError(classroomsQuery.error).message} Nothing could be listed — this does not mean you have no classes.`}
            onRetry={() => void classroomsQuery.refetch()}
          />
        ) : !classrooms ? (
          <LoadingState label="Loading your classrooms…" />
        ) : classrooms.length === 0 ? (
          <EmptyState
            icon={School}
            title="No classrooms yet"
            description="You haven't been added to a classroom yet. Once an administrator assigns you one, its questions show up here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="Classroom" htmlFor={classroomSelectId}>
              <Select
                id={classroomSelectId}
                value={classroomId == null ? "" : String(classroomId)}
                onChange={(e) => setClassroomId(e.target.value === "" ? null : Number(e.target.value))}
              >
                {classrooms.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.name}
                    {classroom.subject ? ` · ${subjectLabel(classroom.subject)}` : ""}
                    {classroom.is_active === false ? " · archived" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Flag a question at"
              htmlFor={thresholdInputId}
              hint={`The school's rule is ${DEFAULT_THRESHOLD}%. Press Enter or tab out to apply.`}
            >
              <ThresholdControl
                value={threshold}
                onChange={setThreshold}
                inputId={thresholdInputId}
              />
            </Field>
          </div>
        )}
      </Card>

      {classroomId != null && (
        <>
          <div className="mt-6">
            <Tabs items={TABS} active={tab} onChange={(id) => setTab(id as TabId)} />
          </div>
          <div className="mt-4">
            {tab === "assessments" ? (
              // Keyed on the classroom so the set picker resets with it rather than carrying
              // a set that belongs to another class.
              <AssessmentsPanel
                key={`assessments-${classroomId}`}
                classroomId={classroomId}
                threshold={threshold}
              />
            ) : (
              <PastPapersPanel
                key={`pastpapers-${classroomId}`}
                classroomId={classroomId}
                threshold={threshold}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
