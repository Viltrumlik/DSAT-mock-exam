# Student Analytics — data sources, serializer change & calculations

> Phase 7 pre-implementation documentation (required before build).
> **Rule honored:** real backend data only; no fabricated skill metrics.

## 1. Existing field source (audit result)

**Per-question SAT skill/domain tags do NOT exist.** Confirmed by reading every backend model:
- `AssessmentQuestion` (backend/assessments/models.py:148) has no skill/domain/strand field.
- `exams` Question / review payload exposes `is_correct`, `duration`, `type` — **no domain tag**.

**The real SAT-taxonomy data is set-level**, on `AssessmentSet`:
- `AssessmentSet.subject` (`math` | `english`) — models.py:16
- `AssessmentSet.category` — models.py:17 — a single SAT-taxonomy strand string `"{domain} › {subdomain}"` chosen by the author from `assessmentSatTaxonomy.ts`.

So "skill" granularity = **strand = the set's `category`**. Each assessment attempt belongs to exactly one set → one strand.

**Already-exposed, real, per-attempt data (no change needed):**
| Source | Fields | Endpoint |
|---|---|---|
| `_build_hw_meta` | **`set_category`** (strand), set_title, due_at | `/assessments/homework/{id}/my-result/`, `/assessments/attempts/{id}/review/` |
| `AssessmentResult` (`ResultSerializer`) | `percent`, `correct_count`, `total_questions`, `score_points`, `max_points`, `graded_at` | same |
| `AssessmentAttempt` (`AttemptSerializer`) | `total_time_seconds`, `question_times`, `answers[]` with **`is_correct`, `time_spent_seconds`, `points_awarded`** | same |
| Exam attempts (`examsPublicApi.getAttempts`) | `score`, `submitted_at`, `is_completed`, `practice_test_details.subject` | `/exams/attempts/` |
| Exam review (`examsPublicApi.getReview`) | `questions[].is_correct`, `questions[].duration`, module subject | `/exams/attempts/{id}/review/` |
| `me` | `target_score`, `last_mock_result.score`, `sat_exam_date` | `/users/me/` |

## 2. Serializer change (the single approved addition)

**One read-only line** — expose the existing `AssessmentSet.subject` in the student meta block. No scoring/business logic, no new calculation, no DB/migration.

`backend/assessments/views.py` → `_build_hw_meta(hw)`:
```python
"set_category": aset.category if aset else None,   # already present
"set_subject": aset.subject if aset else None,     # NEW — existing field, read-only
```
This flows to both `/my-result/` and `/review/` (both build meta via `_build_hw_meta`). `MyAssessmentResultResponseSerializer.meta` is an untyped dict in the response, so no OpenAPI regen is required. `set_category` was **already** exposed — no change there.

Why needed: lets the client group strands by section (Math vs Reading & Writing) and compute assessment-side subject accuracy without parsing the category string.

## 3. Analytics calculations (all client-side, from real data)

| Section | Calculation | Source |
|---|---|---|
| Performance Overview | current = latest mock score; best = max(scores); average = mean(scores); predicted = last + avg recent delta (clamped 400–1600); readiness = round(current/target·100) | getAttempts + me |
| Score History | scores ordered by `submitted_at`; trend = linear slope / Δ over window | getAttempts |
| Subject Analysis (Math, Reading & Writing) | per completed exam attempt, fan out `getReview`; per module subject: accuracy = Σis_correct/Σquestions, time = Σduration, attempts = count, improvement = score slope within subject | getAttempts + getReview (fan-out, cap recent ~15, concurrency 4) |
| Skill Analysis (strand radar) | fan out `/my-result/` over `classesApi.myAssignments()`; bucket by `meta.set_category`; accuracy = Σcorrect_count/Σtotal_questions per strand; subject = `meta.set_subject` | myAssignments + my-result |
| Weakness Detection | from exam review: questions with `is_correct=false` (most-missed) and max `duration` (most time-consuming), grouped by subject; weakest strands from radar (lowest accuracy, min attempts threshold) | getReview + my-result |
| Recommendations | weakest strand → matching assessment/practice; lowest subject → practice that section; stale/no recent mock → take a mock | derived |
| Goal Tracking | progress = current/target; timeline = ceil(gap / avg weekly improvement) weeks (labeled a projection, shown only with ≥2 dated scores); weekly milestones = sessions/week vs goal | getAttempts + me |

**Guards:** every section renders a real empty/teaser state when its data is insufficient (e.g., radar needs ≥3 attempted strands; subject time needs review data). No placeholder numbers. Timeline/predicted are explicitly framed as projections, never presented as fact.

## 4. API payload examples (real shapes)

`GET /assessments/homework/{assignment_id}/my-result/` (after the 1-line change):
```jsonc
{
  "attempt": { "id": 91, "status": "submitted", "submitted_at": "2026-06-02T10:01:00Z",
               "total_time_seconds": 1320,
               "answers": [ { "question_id": 5, "is_correct": true, "time_spent_seconds": 48 } ] },
  "result":  { "percent": 82.0, "correct_count": 18, "total_questions": 22, "score_points": 18, "max_points": 22 },
  "meta":    { "assignment_title": "Linear functions set", "set_title": "Algebra · Linear functions",
               "set_category": "Algebra › Linear functions", "set_subject": "math" }  // set_subject is the new field
}
```
`GET /exams/attempts/{id}/review/` → `{ questions: [ { is_correct, duration, type, ... } ], module_results: [...], total_questions }`.
`GET /exams/attempts/` → `{ items: [ { id, score, submitted_at, is_completed, practice_test_details: { subject } } ] }`.

Strand-radar aggregation (pseudo):
```
for each assignment in myAssignments():
  r = my-result(assignment.id)
  if r.result and r.meta.set_category:
     bucket[r.meta.set_category] += { correct: r.result.correct_count, total: r.result.total_questions, subject: r.meta.set_subject }
radarAxis = { strand, accuracy: 100*correct/total } for buckets with total >= MIN
```
