# Teacher Experience — routes, APIs, data availability & gaps

> Phase 8 pre-implementation deliverable. Real backend data only.
> Admin Panel / Question Bank / Builder / Authoring / Question APIs are untouched.

## 1. Existing teacher routes
| Route | Purpose | Disposition |
|---|---|---|
| `(teacher)/layout.tsx` | Teacher shell (AuthGuard `adminOnly`, NAV: Dashboard/Homework/Students) | replace shell with `AppShell` + teacherNav |
| `/teacher` | Ops dashboard (assignment lifecycle signals) | **rebuild → flagship** |
| `/teacher/homework` | Homework hub | defer to phase 9 (Homework) |
| `/teacher/homework/grading` + `/[classId]/[assignmentId]` | Grading hub + per-assignment grading | **rebuild → Grading** |
| `/teacher/students` | Student roster | defer to phase 9 (Students) |

New routes this phase: `/teacher/grading`, `/teacher/gradebook` (+ keep `/teacher` rebuilt). Analytics `/teacher/analytics` is phase 9.

## 2. Existing teacher APIs (all under `classesApi`, no new endpoints)
| Method | Returns (real fields) |
|---|---|
| `list()` | classrooms `[{id, name, subject, my_role, members_count, lesson_schedule, …}]` — filter `my_role` in {admin, teacher} |
| `getInterventions(classId)` | **`overdue_students[]`** {student_id, first/last_name, email, overdue_count, oldest_overdue_due_at}; **`inactive_students[]`** {…, last_activity_at, days_inactive}; **`low_score_students[]`** {…, avg_score_pct} (<60%); **`completion_summary[]`** {assignment_id, title, due_at, is_overdue, is_assessment, submitted_count, student_count, completion_pct}; **`class_stats`** {student_count, assignment_count, overall_completion_pct, avg_assessment_score_pct} |
| `getLeaderboard(classId)` | `assignments_summary[]` {assignment_id, title, created_at, due_at, practice_test_title, subject, group_mean_score, completed_count, student_headcount, completion_rate_pct}; `homework_grade_leaderboard` (per-student grade ranks) |
| `people(classId)` | members `[{role, user{id, first/last_name, email, username, profile_image_url}}]` |
| `listAssignments(classId)` | `[{id, title, created_at, due_at?, submissions_count?, practice_scope?}]` |
| `listSubmissions(classId, assignmentId)` | `Submission[]` {id, status, revision, submitted_at, updated_at, workflow_status, files[]{url,file_name,file_type}, attempt, student{id,first/last_name,email,username}, review{grade,feedback,context}} |
| `gradeSubmission(submissionId, {grade?, score?, feedback?, expected_revision})` | grades; `expected_revision` = submission.revision (optimistic concurrency) |
| `returnSubmission(submissionId, {note?, expected_revision?})` | returns work for resubmission |
| `getStudentWorkspace(classId)` | per-student workspace (student detail — phase 9) |

## 3. Data availability per planned page
**Teacher Dashboard** — fully real:
- Hero: Total students (Σ class_stats.student_count or people), Active (students − inactive_students), Average score (class_stats.avg_assessment_score_pct), Submission rate (class_stats.overall_completion_pct), Weekly activity (submissions in last 7d via completion/stream).
- Insights: needing attention = low_score_students + overdue_students; improving = leaderboard deltas; missing submissions = completion_summary low %; upcoming = assignments by due_at.
- Charts: **Class average trend** = leaderboard `assignments_summary` group_mean_score by created_at ✅; **Submission activity** = completion_summary ✅; **Student performance** = leaderboard ranks ✅.

**Grading** — fully real: fan out `list()` → `listAssignments` → `listSubmissions`, collect `workflow_status` = needs-grading → queue cards; workspace uses files/attempt + `gradeSubmission`.

**Gradebook** — fully real: `people()` × `listAssignments()` matrix; cells from `listSubmissions`/`getLeaderboard` (completion + scores). Heatmap from completion/score.

## 4. Gaps & constraints (honest)
- **SAT strand performance (class-level):** NOT cleanly available. Strand = assessment-set `category` (per-student `my-result` is self-only; no teacher class-strand endpoint). The Dashboard "SAT strand performance" card and Analytics "Strand performance" will render an **honest "insufficient data"** state, not estimates. (Could be a future read-only aggregate endpoint, like the student `set_subject` change — out of scope now.)
- **Fan-out cost:** Grading/Gradebook require N classes × M assignments × submissions calls. Mitigation: cap to teacher's classes + recent assignments, concurrency-limited; skeletons while loading.
- **"Improving" students:** derived from available score series (leaderboard / assessment averages); shown only with ≥2 data points, else omitted — never fabricated.
- **Weekly activity series:** derived from submission timestamps where present; honest empty if none.
- Gate: teacher routes keep the existing `AuthGuard adminOnly` (staff) — no role-model change.

## 5. IA note
Library removed from the student sidebar (product decision); resources surface contextually. Classes/Assessments deferred (kept functional, not redesigned).
