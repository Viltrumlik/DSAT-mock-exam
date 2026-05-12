# Domain Architecture — questions.mastersat.uz

> **Version:** 1.1  
> **Date:** 2026-05-12  
> **Purpose:** Authoritative mental model for the two educational systems on this platform.  
> **Read before:** building any new student-facing feature, teacher workflow, analytics surface, or data model.

---

## The Core Insight

This platform contains **two distinct educational systems** that share infrastructure but
do **not** share educational identity, student mindset, or workflow logic.

```
                      Question Bank
                            ↓

          Shared Platform Infrastructure
  (rendering, attempts, review, analytics, auth)

                ↓                        ↓

      ASSESSMENT SYSTEM           PASTPAPER SYSTEM
       (Pedagogical)               (Performative)
      learn this concept         perform under SAT conditions
```

Mixing these two systems — treating them as variants of the same product — destroys
educational clarity for students, teachers, and the system itself.

---

## System 1 — Assessment System (Pedagogical)

**Core question:** "Did the student learn this concept?"

**Educational identity:** Learning progression infrastructure.

**Student mindset:** "I am building a skill."

**Defining characteristics:**
- Topic-based: aligned to curriculum domains (algebra, reading comprehension, vocabulary)
- Teacher-assigned: lives inside classroom workflows
- Homework-oriented: due dates, grading, teacher feedback
- Mastery-focused: the goal is demonstrated competence on a concept
- Modular: each assessment is a targeted, bounded unit
- Progression-oriented: results feed forward into what to study next

**Examples:**
- "Algebra 1 — Quadratics Practice" (homework)
- "Reading: Main Idea Questions" (classroom drill)
- "Vocabulary Set 12 — Week 3" (weekly vocabulary quiz)
- "Topic review: Systems of Equations" (mastery check)

**What belongs here:**
- Classroom assignment lifecycle (assign → attempt → grade → feedback)
- Topic mastery tracking and progression
- Homework due dates and teacher grading
- Vocabulary integration (vocabulary is learning progression infrastructure)
- Curriculum-linked analytics (which topics need more attention?)
- Teacher-facing homework management

**What does NOT belong here:**
- SAT section sequencing or timing
- Score benchmarking against official SAT expectations
- Full-length test simulation

---

## System 2 — Pastpaper System (Performative)

**Core question:** "Can the student perform under real SAT conditions?"

**Educational identity:** SAT simulation infrastructure.

**Student mindset:** "I am rehearsing for test day."

**Defining characteristics:**
- Official SAT structure: fixed section order (Reading & Writing → Mathematics)
- Full-length experience: each pack is a complete SAT paper
- Timing-realistic: module time limits match College Board specifications
- Score-realistic: performance benchmarks against real SAT scoring
- Endurance-focused: the experience itself is the preparation
- Benchmark-oriented: results answer "where am I relative to test day?"

**Examples:**
- "SAT March 2024 — International Form" (full past paper pack)
- "SAT Practice Test 5" (official CB practice test)
- "October 2023 — US Form A" (past paper)

**What belongs here:**
- SAT section UX (R&W section, Math section, section-level navigation)
- Module timing and pacing
- Score benchmarking and improvement tracking
- Weak-domain extraction from SAT performance
- Simulation UX identity (this feels like test day, not homework)
- SAT-specific analytics (projected score, section scores, percentile)
- Official SAT identity (form type, practice date, form label)

**What does NOT belong here:**
- Topic homework workflows
- Teacher-assigned due dates
- Vocabulary practice
- Classroom grading

---

## Shared Platform Infrastructure

These capabilities are **platform-level**, not system-level. Both systems use them.

| Capability | What it provides | Key files |
|---|---|---|
| Question Bank | Authored SAT questions (stems, choices, explanations, stimuli) | `builder/bank`, `features/questionsAdmin` |
| Rendering engine | `MathText`, `SafeHtml` — semantic correctness guarantees | `components/MathText.tsx`, `components/SafeHtml.tsx` |
| Attempt infrastructure | Start, resume, expire, submit | `features/examsStudent`, `features/assessmentsStudent` |
| Review infrastructure | Post-attempt question review with explanations | `app/review/[attemptId]` |
| Student identity | Auth, profile, classroom membership | `hooks/useMe`, auth system |
| Classroom membership | Which students are in which class | `app/(main)/classes` |
| Authoring primitives | Question creation, editing, publishing | `features/assessments/builder`, `features/questionsAdmin` |

**Rule:** When something works the same way in both systems (e.g., "render a math expression"),
it lives in shared infrastructure. When something reflects the educational identity of one
system (e.g., "show SAT score benchmarks"), it lives in that system only.

---

## What Must NOT Be Shared

These are the things that must stay system-specific, even when sharing would be technically convenient:

| Concern | Why sharing is wrong |
|---|---|
| **Educational workflows** | An assignment lifecycle (assign → attempt → grade) is pedagogical. An SAT section attempt is performative. The same UI patterns do not serve both. |
| **Assignment semantics** | "Assignment" means a teacher-delegated unit with a due date. It is not a synonym for "something to attempt." |
| **Analytics meaning** | A score in the Assessment system means "percent correct on this topic." A score in the Pastpaper system means "projected SAT section score." The same number means different things. |
| **Student mindset** | When a student opens an assessment, they are learning. When they open a pastpaper section, they are rehearsing for test day. These require different UX signals, framing, and pacing. |
| **Pacing UX** | Assessments are self-paced homework — students can stop and resume freely. SAT sections should feel timed and continuous — stopping breaks the simulation. |
| **Progression logic** | Assessment progression answers "what should I study next?" (mastery-based). Pastpaper progression answers "how close am I to test day readiness?" (benchmark-based). |
| **Review framing** | After an assessment, review means "understand why I got this wrong to build the concept." After an SAT section, review means "understand my performance pattern under test conditions." |
| **Teacher operations** | Grading, feedback, and assignment management are Assessment system operations. Teachers do not manage SAT simulations — students initiate those independently. |

---

## The Convergence Trap

The most dangerous architectural failure is **not** an intentional merger of the two systems.
It is gradual convergence driven by infrastructure convenience.

**How it happens:**
1. Both systems share the attempt infrastructure
2. A new SAT feature needs something "similar to" the assessment assignment flow
3. The existing assessment components are reused "just this once"
4. Over time, the Pastpaper system inherits assessment UI, assessment terminology, and assessment workflows
5. Students experience SAT preparation as a homework assignment
6. The educational identity of the Pastpaper system is destroyed

**The example to reject explicitly:**

> "Let's reuse the assessment assignment flow for SAT mock scheduling."

This is technically convenient. It is educationally wrong. SAT mocks are student-initiated
rehearsals. They are not teacher-assigned homework. Reusing the assignment flow would import
due dates, grading semantics, and classroom identity into a product that should feel like
test-day preparation.

**The principle:**
Shared infrastructure must never be the reason a workflow decision is made.
Infrastructure choice follows educational intent — it does not define it.

When a feature requires choosing between "reuse existing infra but blur the domain" and
"build for this domain but takes longer," build for the domain. The educational identity
of each system is the non-negotiable constraint.

---

## Current Implementation Mapping

### Assessment System routes

| Route | Purpose | System |
|---|---|---|
| `/assessments/[assignmentId]` | Assignment detail — see what's assigned, start attempt | Pedagogical |
| `/assessments/attempt/[attemptId]` | Assessment attempt runner | Pedagogical |
| `/assessments/result/[assignmentId]` | Post-attempt result with score and review link | Pedagogical |
| `/classes/[classId]` | Classroom hub — assignments, members, grades | Pedagogical |
| `/vocabulary/daily` | Daily vocabulary practice | Pedagogical |
| `/vocabulary/words` | Vocabulary word list | Pedagogical |

### Assessment System features

| Feature | Purpose |
|---|---|
| `features/assessments` | Core assessment domain: builder, components, attempt logic |
| `features/assessmentsAdmin` | Admin API for assessment creation and management |
| `features/assessmentsStudent` | Student API for assessment attempts |
| `features/teacher` | Teacher-facing homework and grading tools |
| `components/vocabulary/` | Vocabulary practice components |

### Pastpaper System routes

| Route | Purpose | System |
|---|---|---|
| `/pastpapers` | Pack list — all available SAT past papers | Performative |
| `/pastpapers/[packId]` | Pack detail — start R&W or Math section | Performative |
| `/practice-tests` | Section-level list (pre-pack legacy view) | Performative |
| `/practice-test/[id]` | Section detail — single R&W or Math section | Performative |
| `/mock-exam` | Mock exam list | Performative |
| `/mock/[id]` | Timed full mock exam | Performative |
| `/exam/[attemptId]` | SAT exam runner (used by pastpaper system) | Shared infra |

### Pastpaper System features

| Feature | Purpose |
|---|---|
| `features/exams` | Core exam domain |
| `features/examsAdmin` | Admin API for pastpaper pack management |
| `features/examsStudent` | Student API for exam attempts |

---

## Domain Vocabulary

Use consistent terms. Inconsistent vocabulary is the first sign of domain confusion.

| Term | Belongs to | Meaning |
|---|---|---|
| **Assignment** | Assessment system | A teacher-assigned set given to a classroom with a due date |
| **Assessment set** | Assessment system | The authored content unit (questions authored together) |
| **Attempt** | Shared | A student's in-progress or completed response to an assessment or exam section |
| **Pack** | Pastpaper system | A complete SAT paper (contains R&W section + Math section) |
| **Section** | Pastpaper system | One subject-section of an SAT paper (R&W or Mathematics) |
| **Module** | Pastpaper system | One timed unit within a section (Module 1, Module 2) |
| **Mock** | Pastpaper system | A timed, continuous full-length SAT simulation |
| **Topic** | Assessment system | The curriculum concept an assessment targets |
| **Mastery** | Assessment system | Demonstrated competence on a topic |
| **Score** | Pastpaper system | SAT-scale performance metric |
| **Grade / Points** | Assessment system | Homework evaluation metric |
| **Vocabulary** | Assessment system | Word-learning progression infrastructure |

**Anti-vocabulary — ambiguous terms to avoid:**
- "Practice test" — ambiguous; use "assessment" or "pastpaper section" depending on context
- "Exam" — use only in shared infrastructure contexts (the exam runner); prefer "section" for pastpaper and "assessment" for homework
- "Quiz" — acceptable for Assessment system but not Pastpaper system (quizzes are not SAT simulations)

**Anti-generic vocabulary — never use these in system-specific contexts:**

Generic content language destroys educational clarity. These terms apply to publishing CMS platforms, not to a focused SAT preparation product. If you find yourself using these words, you are probably building the wrong abstraction.

| Generic term | Why it's wrong here | Use instead |
|---|---|---|
| "Content" | "Content" has no educational identity — it says nothing about what the student is supposed to do with it | "Assessment set", "pastpaper section", "vocabulary list" |
| "Activity" | Implies a generic task container — erases the learning/simulation distinction | "Assignment" (pedagogical) or "section" (SAT simulation) |
| "Evaluation" | Bureaucratic; obscures whether the purpose is mastery check or benchmark | "Assessment" or "SAT section score" |
| "Learning object" | CMS abstraction — meaningless in an educational product context | "Question", "assessment set", "module" |
| "Practice item" | Strips context — is this homework practice or SAT simulation practice? | "Assessment question" or "SAT question" |
| "Resource" | Has no student-facing meaning | Name the specific thing |
| "Experience" | Meaningless alone — the systems have opposite experiences by design | "Homework assignment" or "SAT section simulation" |

---

## Vocabulary System — Position Within the Domain Model

Vocabulary is **Learning progression infrastructure** — it belongs entirely inside the
Assessment system.

**Why vocabulary is NOT in the Pastpaper system:**
- Vocabulary learning is cumulative and mastery-based (pedagogical)
- Vocabulary sets are teacher-assigned with progression tracking
- SAT simulations test vocabulary incidentally — they do not teach it
- The vocabulary UX (flashcards, daily practice, quizzes) is fundamentally different
  from the SAT simulation UX

**Current vocabulary routes** (`/vocabulary/daily`, `/vocabulary/words`) are correctly
placed as standalone student-facing pages. Future vocabulary features (teacher assignment,
classroom progress tracking, spaced repetition) belong in the Assessment system.

---

## Separation Enforcement Rules

These rules prevent domain confusion from entering the codebase incrementally.

**Rule 1 — Features do not cross systems.**
`features/exams*` components and hooks must not be imported by `features/assessments*` code,
and vice versa. Cross-system data needs go through shared infrastructure.

**Rule 2 — UI vocabulary reflects educational identity.**
A pastpaper page must never use the word "homework", "topic", or "mastery".
An assessment page must never use the word "SAT score", "section timing", or "simulation".

**Rule 3 — Analytics are system-specific.**
Assessment analytics answer: "which topics need more work?" (mastery)
Pastpaper analytics answer: "where does this student stand relative to test day?" (benchmark)
Do not combine these into one analytics surface.

**Rule 4 — Teacher workflows belong to the Assessment system.**
If a feature is teacher-assigned, due-dated, or graded by a teacher, it is an
Assessment system feature. The Pastpaper system is student-initiated.

**Rule 5 — Vocabulary belongs to the Assessment system.**
Any vocabulary feature that tracks learning progression, teacher assignment, or
cumulative mastery belongs in the Assessment system. Do not create vocabulary-in-SAT-section features.

**Rule 6 — Shared infrastructure is neutral.**
`/review/[attemptId]` renders reviews for both systems. `MathText` renders for both.
The exam runner (`/exam/[attemptId]`) serves both. These are platform capabilities —
they carry no system identity.

**Rule 7 — Infrastructure availability is not a workflow justification.**
"We already have X infrastructure for the Assessment system, so we can reuse it for
the Pastpaper system" is not a valid architectural argument. Infrastructure choice
must follow educational intent — it must not define it. When the correct workflow
for a Pastpaper feature would blur its SAT simulation identity, build the correct
workflow. The convergence trap always starts with infrastructure convenience. See
"The Convergence Trap" section above.

---

## Next Development Priorities

### Assessment System (Pedagogical)
1. Classroom assignment lifecycle — full workflow from teacher assigns to student submits to teacher grades
2. Topic mastery UX — student sees progression per topic over time
3. Vocabulary integration — teacher can assign vocabulary sets alongside assessments
4. Homework analytics — teacher sees class performance on assignments
5. Progression systems — surface patterns across multiple attempts on the same topic

### Pastpaper System (Performative)
1. SAT section UX — section-level timing realism (module transitions, section breaks)
2. Score benchmarking — student sees projected score after completing a section or pack
3. Review loops — after reviewing a section, surface which question types caused most errors
4. Weak-domain extraction — identify which SAT content domains (e.g., "linear functions") need targeted practice
5. Endurance analytics — track performance consistency across Module 1 and Module 2
6. Official SAT identity — UI should feel like preparing for a real test, not doing homework

---

## What This Architecture Is NOT

- **Not a generic content engine.** Content is authored differently, consumed differently, and analyzed differently in each system. "Content" is not a useful abstraction here.
- **Not a unified "assessment" domain.** Pastpapers are not assessments. Assessments are not SAT simulations. Collapsing them into a single domain creates an "assessment blob" with no educational clarity.
- **Not a CMS.** This platform is not a general-purpose educational platform that can host any kind of learning activity. It serves two specific educational jobs: topic mastery and SAT simulation preparation.
- **Not premature.** This document does not require any backend changes. It is a mental model that guides feature placement, vocabulary, workflow design, and analytics architecture.
- **Not optional.** The domain separation is not a preference or an implementation detail. It reflects the actual difference between how students learn a concept and how students prepare to perform on a standardized test. Merging these is not a simplification — it is an educational error.

---

## Governance

This document is updated when:
- A new student-facing workflow is built (determine which system it belongs to)
- A new route is added (add to the implementation mapping tables)
- A vocabulary term is introduced that could cause confusion (add to the domain vocabulary table)
- A domain separation rule is found to be violated (add a correction + update the rule)

This document is **not** updated for:
- UI styling changes
- Question content changes
- Infrastructure refactors that don't change domain boundaries
