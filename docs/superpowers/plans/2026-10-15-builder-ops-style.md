# Builder in the /ops style — plan (2026-10-15)

Owner: "question builderni opsga styledan ko'chirib builderni ham o'zgartiring". Scope chosen in chat:
**everything, two PRs**. The builder stays its own console (questions.mastersat.uz → `/builder`); it is
not merged into /ops. Nav items keep their names and order.

Worktree `/Users/macbook/Projects/dsat-wt-builder-ops`, branch `feat/builder-ops-style` (from main
fa0b1836). No migration in either PR.

## PR1 — frame, dashboard, Question Bank changelist

1. **One shell for both consoles** (`features/ops/shell`).
   - `ConsoleConfig` = root path, brand word, breadcrumb root, nav label, collapse key, groups, visibility rule.
     `OPS_CONSOLE` keeps /ops exactly as it is (same markup and classes, so pixel-identical).
   - `sectionFor(pathname, groups, root)` generalised. The ops default stays the same.
   - The sidebar marks ONE item active: the longest match. That changes nothing for /ops (no nested hrefs).
     The builder needs it because Question Bank, Triage and Imports nest under `/builder/question-bank`.
   - `BUILDER_CONSOLE` (`features/builderShell/builderNav.ts`) has the same items as today's builder sidebar:
     Dashboard · Learning (Question Bank, Triage Queue, Imports, Sets bank (legacy), Assessments, Midterms,
     Vocabulary, Categories) · Simulation (Past papers, Practice tests, Full mocks) · Archived.
   - `app/(builder)/builder/layout.tsx` mounts `OpsShell` with `BUILDER_CONSOLE`. Editor routes stay
     full-screen (same regexes).
2. **Dashboard** (`/builder`) in the ops dashboard dialect: `text-lg` title, square bordered boxes with
   uppercase captions, and divided link rows. Same content: Continue working, quick links by
   Learning/Simulation plus Archived, and the content-state legend.
3. **Question Bank changelist**.
   - Backend `GET /api/questionbank/questions/changelist/` (new; `questions/` is unchanged for its pickers).
     It takes `q`, the filters `subject|status|difficulty|source|classified`, `o`, `page` and `page_size`
     (25/50/100). It answers with `count, page, pages, page_size, ordering, results` (the
     BankQuestionListSerializer rows) and `filters`. Each filter option carries a facet count: search plus
     every OTHER filter.
   - Orderings: `qb_id`, `-qb_id`, `created`, `-created` (default) and `updated`, `-updated`.
   - Frontend `/builder/question-bank` uses the shared `ChangeList` (its file is not touched — `feat/ops-detail-pages`
     edits it). Columns: QB-ID (link), Question (link, truncated), Subject, Domain › Skill, Difficulty,
     Status (plain text), Created.
   - Header actions: New question, Triage Queue, Imports. Bulk: Approve, and Reject with a confirm, through
     the existing `questions/bulk/`, with a toast summary as on the people lists.
4. **Tests.**
   - Backend view tests: facets, search, ordering, paging, permission.
   - vitest: generalised `sectionFor` / longest-match active, builder nav, the QB query mapping.
     Existing OpsShell and opsNav tests stay green.
   - tsc 0.
5. **Proof.** Screenshots with `/api` stubbed: /builder, /builder/question-bank (desktop + mobile), and the
   /ops dashboard before/after with a pixel diff.

## PR2 — every other builder list page in the ops dialect (stacked on PR1, targets main)

Pages: Assessments (`sets`), Midterms, Vocabulary (3 levels), Past papers, Practice tests, Full mocks
(+ mock detail), Categories, Archived, Imports (+ batch), Triage, Sets bank (legacy), and the question
detail/new pages' outer frame.

- Restyle only: same blocks, same order, same words, same controls.
- The dialect, from the /ops pages:
  - header `text-lg font-semibold` + `text-[13px]` muted line;
  - `rounded-md` 8px-tall buttons at 13px;
  - `border border-border bg-card` square boxes with `text-[12px] uppercase` captions;
  - dense tables (`text-[13px]`, 34px rows, hairline rows, sticky header);
  - `rounded-md` inputs and selects at h-8;
  - no `rounded-2xl` cards, no `font-extrabold`/`font-black`, no tinted status badges.
- A few tiny shared pieces in `features/builderShell/ui.tsx` (`ConsoleHeader`, `ConsoleBox`, `consoleBtn`,
  `consoleInput`) so the pages do not each re-spell the classes.
- Proof: screenshots of every page (stubbed), vitest + tsc green.

Deploy: only on the owner's yes, as a zero-downtime full release switch (no migration).
