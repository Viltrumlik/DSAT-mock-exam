"use client";

/**
 * /teacher/assessments — every assessment a teacher can reach, and the door into the practice
 * runner (see app/(teacher)/teacher/assessments/[setId]/practice).
 *
 * Read-only: this page lists, filters and opens. It authors nothing, which is why the row has no
 * edit control and why the count it prints is a fact about a sitting rather than about a draft.
 *
 * It was the last of the panel's daily surfaces still in the old look — the teachers the owner
 * surveyed named assessments as one of the three things they touch every day — so the list is
 * the same list, with the same search, the same subject filter and the same Practice button; it
 * is the frame around them that changed. The one behaviour that is not a restyle is the failure
 * case: the old page drew the error banner and the "nothing here" card as siblings, so a 403
 * told the teacher both that the request broke and that they have no assessments. Only one of
 * those was ever true at a time.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Calculator, ClipboardCheck, Play, Search } from "lucide-react";
import { Button, Card, DataTable, EmptyState, ErrorState, Pill, Skeleton, TeacherPage, type Column } from "../ui";
import type { TeacherAssessment } from "./api";
import { useTeacherAssessments } from "./hooks";
import { assessmentTitle, isMath, matchesSubject, searchBlob, subjectLabel, type SubjectFilter } from "./labels";

export function TeacherAssessments() {
  const router = useRouter();
  const query = useTeacherAssessments();
  // Memoised so the empty fallback is the SAME array each render — otherwise the filtering
  // below re-runs on every keystroke's re-render whether or not anything changed.
  const sets = useMemo(() => query.data?.sets ?? [], [query.data]);

  const [subject, setSubject] = useState<SubjectFilter>("ALL");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sets.filter((s) => {
      if (!matchesSubject(s, subject)) return false;
      if (q && !searchBlob(s).includes(q)) return false;
      return true;
    });
  }, [sets, subject, search]);

  const columns: Column<TeacherAssessment>[] = [
    {
      key: "title",
      header: "Assessment",
      render: (s) => (
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{assessmentTitle(s)}</span>
            {/* Drafts stay in the list rather than being filtered out of it: a teacher who
                authored one needs to find it, and the practice runner opens it either way.
                The marker sits on the name because it is an exception on a few rows, not a
                column of blanks. */}
            {s.isDraft && <Pill tone="warning">Draft</Pill>}
          </span>
          {s.category && <span style={{ fontSize: 12, color: "var(--dz-mute)" }}>{s.category}</span>}
        </span>
      ),
    },
    {
      key: "subject",
      header: "Subject",
      render: (s) => (
        <Pill tone={isMath(s.subject) ? "success" : "info"}>
          {isMath(s.subject) ? <Calculator size={13} aria-hidden /> : <BookOpen size={13} aria-hidden />}
          {subjectLabel(s.subject)}
        </Pill>
      ),
    },
    {
      key: "level",
      header: "Level",
      render: (s) => s.level || <span style={{ color: "var(--dz-faint)" }}>—</span>,
    },
    {
      key: "questions",
      header: "Questions",
      align: "right",
      width: 110,
      render: (s) => s.questionCount,
    },
    {
      key: "practice",
      header: "Practice",
      align: "right",
      width: 150,
      render: (s) => (
        <Button onClick={() => router.push(`/teacher/assessments/${s.id}/practice`)}>
          <Play size={14} aria-hidden />
          Practice
        </Button>
      ),
    },
  ];

  return (
    <TeacherPage
      title="Assessments"
      subtitle="Open one to solve it yourself in the view your students see. Nothing you answer is saved."
    >
      <Card
        title="The library"
        subtitle={query.isSuccess ? `${sets.length} ${sets.length === 1 ? "assessment" : "assessments"}` : undefined}
        icon={<ClipboardCheck size={20} aria-hidden />}
      >
        {query.isError ? (
          <ErrorState
            title="The assessments didn't load"
            detail="The library did not answer. Nothing has been taken away from you — we simply could not read the list."
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <Skeleton height={40} count={6} />
        ) : sets.length === 0 ? (
          // A teacher whose subject has nothing authored yet must be told THAT, in words, and
          // never shown the blank a failed request would leave behind.
          <EmptyState
            title="No assessments available to you yet"
            hint="Assessments appear here once the learning center adds them for your subject."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Filters subject={subject} onSubject={setSubject} search={search} onSearch={setSearch} />
            {/* Said out loud, because the search and the subject buttons below both run over the
                array we hold: if the walk stopped short, every one of them would otherwise
                answer "no assessment matches" about work that does exist. */}
            {query.data?.truncated && (
              <p style={{ fontSize: 13, color: "var(--dz-mute)", margin: 0 }}>
                Showing the first {sets.length} of {query.data.total}. The search and the subject
                buttons only reach these.
              </p>
            )}
            <DataTable
              label="Assessments"
              columns={columns}
              rows={rows}
              rowKey={(s) => s.id}
              // Unconditional, and it needs no `narrowed` guard: this branch only runs with
              // sets in hand, so an empty `rows` here can only be the filters' doing. The
              // library being empty is the branch above, and it says something else.
              empty={<EmptyState title="No assessment matches" hint="Try the other subject, or a shorter search." />}
            />
          </div>
        )}
      </Card>
    </TeacherPage>
  );
}

function Filters({ subject, onSubject, search, onSearch }: {
  subject: SubjectFilter; onSubject: (v: SubjectFilter) => void;
  search: string; onSearch: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <Segmented
        label="Subject"
        value={subject}
        onChange={(v) => onSubject(v as SubjectFilter)}
        options={[{ v: "ALL", l: "All" }, { v: "math", l: "Math" }, { v: "english", l: "English" }]}
      />
      <label style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--dz-faint)", display: "flex" }}>
          <Search size={15} aria-hidden />
        </span>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search assessments…"
          aria-label="Search assessments"
          style={{
            width: "100%", boxSizing: "border-box",
            border: "1px solid var(--dz-border)", background: "var(--dz-panel)",
            borderRadius: 14, padding: "10px 14px 10px 36px",
            fontFamily: "inherit", fontSize: 14, color: "var(--dz-ink)", outline: "none",
          }}
        />
      </label>
    </div>
  );
}

/**
 * The kit still has no segmented control, and Past papers keeps a local copy for the same
 * reason. Lifting it into `features/teacher/ui` would touch that page and the kit's barrel,
 * neither of which this slice owns; the second caller is the argument for doing it, and the
 * copy is deliberately identical so the move is a delete rather than a merge.
 */
function Segmented({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--dz-faint)" }}>
        {label}
      </span>
      <div role="group" aria-label={label} style={{ display: "flex", gap: 4, background: "var(--dz-neutral-soft)", borderRadius: 12, padding: 4 }}>
        {options.map((o) => {
          const active = o.v === value;
          return (
            <button
              key={o.v}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.v)}
              style={{
                padding: "6px 12px", borderRadius: 9, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                background: active ? "var(--dz-indigo)" : "transparent",
                color: active ? "#fff" : "var(--dz-mute)",
              }}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
