"""
Per-game vocabulary scoring: accuracy discounted by COVERAGE.

The rule these tests pin (OVERHAUL.md §4)::

    set_percent  = Σ over the 4 modes (game_percent) / 4
    game_percent = accuracy × coverage        (0 for a mode never completed)
    coverage     = min(1, distinct_words_answered / set_word_count)

Only the right-hand half of that lives here — one session's own numbers. The
four-mode roll-up is ``rewards.homework._vocab_items`` and is tested there.

Why coverage exists at all is the whole point of this file: raw ``accuracy`` is not
comparable across the four games and is farmable in seconds. Speed only ever reports
the prompts answered before its 60-second clock expires, so two of twenty words
answered correctly stores ``accuracy = 100``. ``SpeedFarmingRegressionTests`` is that
exact scenario and is the reason the column was added.

Note what did NOT change and is therefore still asserted the old way elsewhere:
``accuracy`` itself (raw, unscaled, still the flush-accumulated ratio) and
``is_completed_by`` ("any one mode completes the set"). Scoring and "done" are
deliberately different questions now — see ``test_a_farmed_run_still_completes_the_set``.
"""

from __future__ import annotations

from importlib import import_module

from django.apps import apps as django_apps
from django.test import TestCase
from django.utils import timezone

from vocabulary.models import VocabSet, VocabStudySession, VocabWord

from .test_vocab_api import VocabFixture, make_section, make_set


class CoverageMathTests(TestCase):
    """
    ``coverage``/``scaled_accuracy`` as pure arithmetic, off the wire.

    Unsaved instances on purpose: these are the two functions every homework percent
    in the system multiplies through, and they must be provably total — no input
    shape may raise, because ``rewards.services.award`` swallows exceptions and a
    ZeroDivisionError here would surface only as a log line and a silently unpaid
    homework.
    """

    def _session(self, *, accuracy=0.0, distinct=0) -> VocabStudySession:
        return VocabStudySession(accuracy=accuracy, distinct_words=distinct)

    def test_an_empty_set_scores_zero_instead_of_dividing_by_zero(self):
        # A set with no words is reachable: a student's custom set is created empty, and
        # a builder can strip a bank set back to nothing. ``set_size`` is the denominator,
        # so this is the division-by-zero case.
        session = self._session(accuracy=100.0, distinct=5)
        self.assertEqual(session.coverage(0), 0.0)
        self.assertEqual(session.scaled_accuracy(0), 0.0)

    def test_coverage_is_the_share_of_the_set_the_run_actually_reached(self):
        self.assertAlmostEqual(self._session(distinct=2).coverage(20), 0.1)
        self.assertAlmostEqual(self._session(distinct=10).coverage(20), 0.5)
        self.assertAlmostEqual(self._session(distinct=20).coverage(20), 1.0)

    def test_a_mode_that_answered_nothing_covers_nothing(self):
        # The "0 for a mode never completed" arm of the formula, from the other side: a
        # session can exist, be completed, and still have touched no word of the set.
        session = self._session(accuracy=0.0, distinct=0)
        self.assertEqual(session.coverage(20), 0.0)
        self.assertEqual(session.scaled_accuracy(20), 0.0)

    def test_coverage_is_capped_at_one_when_the_set_shrank_under_the_run(self):
        # ``word_ids`` REPLACES membership on a custom set, so a set can shrink below the
        # number of words a past session answered. Uncapped, that run would score 333% and
        # a shrunken set would pay more than a complete one.
        session = self._session(accuracy=90.0, distinct=10)
        self.assertEqual(session.coverage(3), 1.0)
        self.assertAlmostEqual(session.scaled_accuracy(3), 90.0)

    def test_scaled_accuracy_is_accuracy_discounted_by_coverage(self):
        self.assertAlmostEqual(self._session(accuracy=100.0, distinct=2).scaled_accuracy(20), 10.0)
        self.assertAlmostEqual(self._session(accuracy=50.0, distinct=10).scaled_accuracy(20), 25.0)
        self.assertAlmostEqual(self._session(accuracy=80.0, distinct=20).scaled_accuracy(20), 80.0)

    def test_a_perfect_full_run_is_worth_its_raw_accuracy_and_no_more(self):
        # Coverage must not become a bonus multiplier for the honest student either: full
        # coverage leaves accuracy exactly as it was, which is what makes the discount fair.
        session = self._session(accuracy=100.0, distinct=25)
        self.assertEqual(session.coverage(25), 1.0)
        self.assertAlmostEqual(session.scaled_accuracy(25), 100.0)


class SpeedFarmingRegressionTests(VocabFixture):
    """
    THE regression. Speed's 60-second clock means a session reports only the prompts
    answered before it expired, so two-of-twenty-correct stores ``accuracy = 100``.

    Under the old rule ("100 if any mode completed") that run took the vocabulary slot
    outright. Under the new one it is worth 10 — which is what it was.
    """

    def setUp(self):
        super().setUp()
        self.twenty = make_set(
            self.section, title="Speed set", words=tuple(f"sp{i}" for i in range(20))
        )
        self.twenty_words = [
            i.word for i in self.twenty.items.select_related("word").order_by("order")
        ]

    def test_two_of_twenty_words_answered_correctly_scores_ten_not_a_hundred(self):
        session_id = self._start(set_id=self.twenty.id, mode="speed").json()["id"]
        body = self._finish(
            session_id,
            [{"word_id": w.id, "correct": True} for w in self.twenty_words[:2]],
            duration_ms=60_000,
        ).json()

        # Raw accuracy is untouched by the overhaul — the run really did get 2 of 2 right.
        self.assertEqual((body["correct_count"], body["total_count"]), (2, 2))
        self.assertEqual(body["accuracy"], 100.0)
        # What the overhaul added: how much of the set that 100% was measured over.
        self.assertEqual(body["distinct_words"], 2)
        self.assertAlmostEqual(body["coverage"], 0.1)

        session = VocabStudySession.objects.get(pk=session_id)
        self.assertAlmostEqual(session.scaled_accuracy(self.twenty.items.count()), 10.0)

    def test_sitting_the_whole_set_at_the_same_accuracy_pays_ten_times_more(self):
        # The two runs are indistinguishable on ``accuracy`` alone. Coverage is the only
        # thing that separates them, so assert the gap and not just the numbers.
        farmed_id = self._start(set_id=self.twenty.id, mode="speed").json()["id"]
        self._finish(
            farmed_id,
            [{"word_id": w.id, "correct": True} for w in self.twenty_words[:2]],
        )
        honest_id = self._start(set_id=self.twenty.id, mode="test").json()["id"]
        self._finish(
            honest_id,
            [{"word_id": w.id, "correct": True} for w in self.twenty_words],
        )

        farmed = VocabStudySession.objects.get(pk=farmed_id)
        honest = VocabStudySession.objects.get(pk=honest_id)
        self.assertEqual(farmed.accuracy, honest.accuracy)
        self.assertAlmostEqual(farmed.scaled_accuracy(20), 10.0)
        self.assertAlmostEqual(honest.scaled_accuracy(20), 100.0)

    def test_a_farmed_run_still_completes_the_set(self):
        # ``is_completed_by`` deliberately did NOT change: it drives the set list, the
        # launcher state and a badge, and "done" is now a different question from "worth
        # how much". A 10%-scoring run still turns the card green.
        session_id = self._start(set_id=self.twenty.id, mode="speed").json()["id"]
        body = self._finish(
            session_id,
            [{"word_id": w.id, "correct": True} for w in self.twenty_words[:2]],
        ).json()
        self.assertTrue(body["set_completed"])


class DistinctWordAccumulationTests(VocabFixture):
    """
    ``distinct_words`` is a UNION across flushes, not a sum.

    Two facts collide here. A mode flushes only the answers it has not sent yet, so the
    count has to accumulate; and the same word legitimately arrives in more than one
    flush, because flashcards re-drill the missed pile into the *same* run and report
    every verdict of every round. Summing each flush's own distinct count would inflate
    coverage past what the student covered — and coverage is the anti-farming term, so
    inflating it hands back exactly what it was added to take away.
    """

    def setUp(self):
        super().setUp()
        self.ten = make_set(
            self.section, title="Ten", words=tuple(f"t{i}" for i in range(10))
        )
        self.ten_words = [
            i.word for i in self.ten.items.select_related("word").order_by("order")
        ]

    def _flush(self, session_id, results, *, partial=True, duration_ms=1_000):
        return self._finish(session_id, results, duration_ms=duration_ms, partial=partial)

    def _hits(self, words, correct=True):
        return [{"word_id": w.id, "correct": correct} for w in words]

    def test_distinct_words_accumulates_across_partial_flushes(self):
        session_id = self._start(set_id=self.ten.id).json()["id"]

        first = self._flush(session_id, self._hits(self.ten_words[:4])).json()
        self.assertEqual(first["distinct_words"], 4)
        self.assertAlmostEqual(first["coverage"], 0.4)

        second = self._flush(session_id, self._hits(self.ten_words[4:7])).json()
        self.assertEqual(second["distinct_words"], 7)
        self.assertAlmostEqual(second["coverage"], 0.7)

        final = self._flush(
            session_id, self._hits(self.ten_words[7:]), partial=False
        ).json()
        self.assertEqual(final["total_count"], 10)
        self.assertEqual(final["distinct_words"], 10)
        self.assertAlmostEqual(final["coverage"], 1.0)

    def test_a_word_re_drilled_in_a_later_flush_is_not_counted_twice(self):
        # The flashcard shape: five cards, two missed, the missed pair re-drilled after
        # the first flush went out. Eight verdicts over five words.
        session_id = self._start(set_id=self.ten.id).json()["id"]

        self._flush(
            session_id,
            self._hits(self.ten_words[:3]) + self._hits(self.ten_words[3:5], correct=False),
        )
        body = self._flush(
            session_id,
            self._hits(self.ten_words[3:5]) + self._hits(self.ten_words[1:2]),
            partial=False,
        ).json()

        # total_count counts card-views, distinct_words counts words. The gap is the point.
        self.assertEqual(body["total_count"], 8)
        self.assertEqual(body["distinct_words"], 5)
        self.assertAlmostEqual(body["coverage"], 0.5)

        session = VocabStudySession.objects.get(pk=session_id)
        self.assertEqual(
            session.answered_word_ids, sorted(w.id for w in self.ten_words[:5])
        )

    def test_a_word_answered_twice_inside_one_flush_counts_once(self):
        session_id = self._start(set_id=self.ten.id).json()["id"]
        word = self.ten_words[0]
        body = self._finish(
            session_id,
            [
                {"word_id": word.id, "correct": False},
                {"word_id": word.id, "correct": True},
            ],
        ).json()
        self.assertEqual(body["total_count"], 2)
        self.assertEqual(body["distinct_words"], 1)
        self.assertAlmostEqual(body["coverage"], 0.1)

    def test_answers_for_words_outside_the_set_cannot_pad_coverage(self):
        # The cheapest possible farm if it worked: post 10 ids that are not in the set and
        # read coverage 1.0 off a set you never opened.
        stray = VocabWord.objects.create(
            section=self.section, word="interloper", definition="not in the set"
        )
        session_id = self._start(set_id=self.ten.id).json()["id"]
        body = self._finish(
            session_id,
            [
                {"word_id": self.ten_words[0].id, "correct": True},
                {"word_id": stray.id, "correct": True},
            ],
        ).json()
        self.assertEqual(body["total_count"], 1)
        self.assertEqual(body["distinct_words"], 1)
        session = VocabStudySession.objects.get(pk=session_id)
        self.assertEqual(session.answered_word_ids, [self.ten_words[0].id])

    def test_a_flush_after_completion_cannot_raise_coverage(self):
        # The modes flush on unload, so a duplicate finish is a normal event. It must not
        # top up a banked run — the FIRST completed session per (set, mode) is what scores,
        # and a completed row is final.
        session_id = self._start(set_id=self.ten.id).json()["id"]
        self._finish(session_id, self._hits(self.ten_words[:2]))
        body = self._finish(session_id, self._hits(self.ten_words)).json()
        self.assertEqual(body["distinct_words"], 2)
        self.assertAlmostEqual(body["coverage"], 0.2)
        session = VocabStudySession.objects.get(pk=session_id)
        self.assertEqual(session.distinct_words, 2)
        self.assertAlmostEqual(session.scaled_accuracy(10), 20.0)

    def test_an_abandoned_run_banks_the_coverage_it_reached(self):
        # A partial flush leaves ``completed_at`` unset, so the run scores nothing at all
        # (the scoring query filters ``completed_at__isnull=False``) — but the words it
        # did answer are recorded, so a later finishing flush resumes rather than restarts.
        session_id = self._start(set_id=self.ten.id).json()["id"]
        body = self._flush(session_id, self._hits(self.ten_words[:6])).json()
        self.assertEqual(body["distinct_words"], 6)
        session = VocabStudySession.objects.get(pk=session_id)
        self.assertIsNone(session.completed_at)
        self.assertAlmostEqual(session.coverage(10), 0.6)


class CustomSetCoverageTests(VocabFixture):
    """A student's own set is editable under a finished run — the cap, end to end."""

    def test_a_set_with_no_words_finishes_at_zero_coverage_instead_of_500ing(self):
        # The division-by-zero case over the wire, not just in the arithmetic: the finish
        # serializer divides by ``len(word_ids)`` too, and an empty custom set is one POST
        # away for any student.
        created = self.client.post(
            "/api/vocabulary/my-sets/", {"title": "Empty", "word_ids": []}, format="json"
        )
        set_id = created.json()["id"]
        session_id = self._start(set_id=set_id, mode="test").json()["id"]

        r = self._finish(session_id, [{"word_id": self.words[0].id, "correct": True}])
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["total_count"], 0)
        self.assertEqual(body["distinct_words"], 0)
        self.assertEqual(body["coverage"], 0.0)
        self.assertEqual(VocabStudySession.objects.get(pk=session_id).scaled_accuracy(0), 0.0)

    def test_shrinking_a_studied_set_cannot_push_coverage_over_one(self):
        words = [
            VocabWord.objects.create(section=self.section, word=f"c{i}", definition="d")
            for i in range(5)
        ]
        created = self.client.post(
            "/api/vocabulary/my-sets/",
            {"title": "Mine", "word_ids": [w.id for w in words]},
            format="json",
        )
        set_id = created.json()["id"]

        session_id = self._start(set_id=set_id, mode="test").json()["id"]
        self._finish(session_id, [{"word_id": w.id, "correct": True} for w in words])

        # ``word_ids`` replaces membership: the set is now two words wide, with a run
        # against it that answered five.
        patched = self.client.patch(
            f"/api/vocabulary/my-sets/{set_id}/",
            {"title": "Mine", "word_ids": [w.id for w in words[:2]]},
            format="json",
        )
        self.assertEqual(patched.status_code, 200, patched.content)

        session = VocabStudySession.objects.get(pk=session_id)
        size = VocabSet.objects.get(pk=set_id).items.count()
        self.assertEqual(size, 2)
        self.assertEqual(session.distinct_words, 5)
        self.assertEqual(session.coverage(size), 1.0)
        self.assertAlmostEqual(session.scaled_accuracy(size), 100.0)


class HomeworkBindingTests(VocabFixture):
    """
    Which ``VocabHomework`` a run is bound to — the input to the per-set scoring query.

    ``VocabStudySession.homework`` was populated and never read, so a set assigned to two
    classes paid twice (OVERHAUL.md §9). Now that ``rewards.homework._vocab_items`` filters
    on it, the value the start endpoint picks is load-bearing, and it picks exactly one:
    the NEWEST published assignment of that set among the student's classrooms.

    This test documents that choice rather than endorsing it — see the note reported
    alongside this work about a student enrolled in both classes.
    """

    def test_a_run_binds_to_the_newest_class_that_set_the_same_words(self):
        older = self._assign_as_homework()
        newer = self._assign_as_homework()
        self.assertNotEqual(older.id, newer.id)

        session_id = self._start().json()["id"]
        self.assertEqual(
            VocabStudySession.objects.get(pk=session_id).homework_id, newer.id
        )

    def test_self_study_on_an_unassigned_set_binds_to_nothing(self):
        # An unbound run belongs to nobody else, so it still counts for whichever homework
        # later attaches the set — the time floor is what keeps last term's out.
        loose = make_set(self.section, title="Unassigned", words=("solo",))
        session_id = self._start(set_id=loose.id).json()["id"]
        self.assertIsNone(VocabStudySession.objects.get(pk=session_id).homework_id)


class BackfillEstimateTests(VocabFixture):
    """
    Migration 0006's ``seed_distinct_words``, called directly.

    The suite builds its database by running every migration against an empty schema, so
    the schema half of 0006 is exercised on every run — but the RunPython half never sees
    a row and would ship untested. It is the half with the consequences: left at 0, every
    run that finished before the column existed covers nothing, and homework already set
    and already done goes from complete to worthless on the deploy, scored on a question
    nobody asked the student at the time.
    """

    def setUp(self):
        super().setUp()
        self.migration = import_module("vocabulary.migrations.0006_vocab_session_coverage")

    def _session(self, *, total, completed=True, vocab_set=None):
        return VocabStudySession.objects.create(
            user=self.student,
            vocab_set=vocab_set or self.vset,
            mode="test",
            total_count=total,
            correct_count=total,
            completed_at=timezone.now() if completed else None,
        )

    def _run(self):
        self.migration.seed_distinct_words(django_apps, None)

    def test_a_past_run_is_credited_with_the_words_it_answered(self):
        # self.vset is 3 words wide.
        session = self._session(total=2)
        self._run()
        session.refresh_from_db()
        self.assertEqual(session.distinct_words, 2)
        self.assertAlmostEqual(session.coverage(3), 2 / 3)

    def test_the_estimate_is_capped_at_the_set_size(self):
        # Flashcards re-drill the missed pile, so total_count legitimately exceeds the set
        # size. Uncapped, that past run would read as coverage 2.0.
        session = self._session(total=6)
        self._run()
        session.refresh_from_db()
        self.assertEqual(session.distinct_words, 3)
        self.assertEqual(session.coverage(3), 1.0)

    def test_an_unfinished_run_is_left_alone(self):
        # It can still be flushed again, and that flush rebuilds distinct_words from the
        # (empty) answered_word_ids union — which would overwrite an estimate with a
        # smaller real number.
        session = self._session(total=2, completed=False)
        self._run()
        session.refresh_from_db()
        self.assertEqual(session.distinct_words, 0)

    def test_running_it_twice_does_not_compound(self):
        session = self._session(total=2)
        self._run()
        self._run()
        session.refresh_from_db()
        self.assertEqual(session.distinct_words, 2)

    def test_every_row_is_written_when_the_backlog_spans_several_batches(self):
        # The batching loop resets ``pending`` after each flush and flushes the remainder
        # after the loop; a mis-placed reset silently drops whole batches, and the estimate
        # cannot be recomputed later because nothing recorded WHICH words a past run saw.
        self.migration.BACKFILL_BATCH = 2
        self.addCleanup(setattr, self.migration, "BACKFILL_BATCH", 500)
        sessions = [self._session(total=2) for _ in range(5)]
        self._run()
        for session in sessions:
            session.refresh_from_db()
            self.assertEqual(session.distinct_words, 2)


class ReplayedModeTests(VocabFixture):
    """
    A replay mints a NEW session row, and the scoring rule takes the first completed one
    per (set, mode) — matching the assessment rule, where a retry is practice and not a
    second earning. Nothing in the schema picks a row on its own, so the ordering key
    ``(completed_at, id)`` has to be answerable from the rows the API creates.
    """

    def setUp(self):
        super().setUp()
        self.section_b = make_section("Barron", slug="barron", order=1)
        self.five = make_set(
            self.section_b, title="Five", words=tuple(f"f{i}" for i in range(5))
        )
        self.five_words = [
            i.word for i in self.five.items.select_related("word").order_by("order")
        ]

    def test_a_replay_creates_a_second_row_and_the_first_one_stays_first(self):
        weak_id = self._start(set_id=self.five.id, mode="matching").json()["id"]
        self._finish(
            weak_id, [{"word_id": self.five_words[0].id, "correct": False}]
        )
        strong_id = self._start(set_id=self.five.id, mode="matching").json()["id"]
        self._finish(
            strong_id,
            [{"word_id": w.id, "correct": True} for w in self.five_words],
        )

        self.assertNotEqual(weak_id, strong_id)
        rows = list(
            VocabStudySession.objects.filter(
                user=self.student, vocab_set=self.five, mode="matching"
            ).order_by("completed_at", "id")
        )
        self.assertEqual([r.pk for r in rows], [weak_id, strong_id])
        self.assertEqual(rows[0].accuracy, 0.0)
        self.assertAlmostEqual(rows[0].scaled_accuracy(5), 0.0)
        self.assertAlmostEqual(rows[1].scaled_accuracy(5), 100.0)

    def test_two_runs_finishing_in_the_same_tick_are_still_ordered(self):
        # ``completed_at`` is one Python ``timezone.now()`` per request, not a database
        # clock, so two runs CAN carry the identical timestamp — and on a re-drill the
        # second row is the better one. Ordered on ``completed_at`` alone the winner is
        # whatever the planner happens to return, which makes "the first game counts"
        # non-deterministic and lets a homework percent flip between two sweeps of the
        # same unchanged data. ``id`` is the tie-break that stops it.
        first_id = self._start(set_id=self.five.id, mode="speed").json()["id"]
        self._finish(first_id, [{"word_id": self.five_words[0].id, "correct": False}])
        second_id = self._start(set_id=self.five.id, mode="speed").json()["id"]
        self._finish(
            second_id, [{"word_id": w.id, "correct": True} for w in self.five_words]
        )

        pinned = timezone.now()
        VocabStudySession.objects.filter(pk__in=[first_id, second_id]).update(
            completed_at=pinned
        )

        rows = list(
            VocabStudySession.objects.filter(
                user=self.student, vocab_set=self.five, mode="speed"
            ).order_by("completed_at", "id")
        )
        self.assertEqual([r.completed_at for r in rows], [pinned, pinned])
        self.assertEqual([r.pk for r in rows], [first_id, second_id])
        # The roll-up takes the first row per mode, so the tie must resolve to the WEAK
        # run — the one that actually happened first.
        self.assertAlmostEqual(rows[0].scaled_accuracy(5), 0.0)


class ModeContractTests(VocabFixture):
    """
    The four mode codes are load-bearing arithmetic, not a display detail.

    ``rewards.homework._vocab_items`` sums one ``scaled_accuracy`` per mode and divides by
    ``len(VocabStudySession.MODE_CHOICES)``. The denominator is therefore whatever this
    model declares: adding a fifth mode re-splits every set from quarters into fifths, and
    because the deadline sweep re-runs ``recompute_bundle`` for days after the due date, it
    would do that to homework that had already settled.
    """

    def test_the_model_declares_exactly_the_four_scored_modes(self):
        self.assertEqual(
            [code for code, _label in VocabStudySession.MODE_CHOICES],
            ["flashcard", "matching", "speed", "test"],
        )

    def test_every_declared_mode_is_startable_and_scores_on_its_own_coverage(self):
        # Each mode is a quarter of the set, so a mode the API refuses to start is a
        # quarter no student can ever reach.
        for code, _label in VocabStudySession.MODE_CHOICES:
            with self.subTest(mode=code):
                started = self._start(mode=code)
                self.assertEqual(started.status_code, 201, started.content)
                body = self._finish(
                    started.json()["id"],
                    [{"word_id": self.words[0].id, "correct": True}],
                ).json()
                self.assertEqual(body["mode"], code)
                self.assertEqual(body["distinct_words"], 1)
                session = VocabStudySession.objects.get(pk=started.json()["id"])
                # 1 of 3 words, all correct: 100 × 1/3.
                self.assertAlmostEqual(session.scaled_accuracy(3), 100 / 3)

    def test_a_mode_outside_the_choice_set_is_refused_at_the_door_but_not_by_the_model(self):
        # OVERHAUL.md §9 found fixtures written as mode="flashcards". The plural is not a
        # choice, and Django does NOT enforce ``choices`` on ``create()`` — so such a row
        # saves happily, matches no mode slot in the roll-up, and silently costs the
        # student a quarter of the set while every assertion about it still passes.
        self.assertEqual(self._start(mode="flashcards").status_code, 400)

        bogus = VocabStudySession.objects.create(
            user=self.student,
            vocab_set=self.vset,
            mode="flashcards",
            completed_at=timezone.now(),
        )
        bogus.refresh_from_db()
        self.assertEqual(bogus.mode, "flashcards")
        self.assertNotIn(
            bogus.mode, [code for code, _label in VocabStudySession.MODE_CHOICES]
        )
        # Only the API stands between that row and the database, which is why the 400
        # above is the assertion that matters.


class AssignedSetGrowthTests(VocabFixture):
    """
    Coverage's denominator is the set's LIVE word count — and a set can grow while it is
    live homework.

    **REPORTED, NOT FIXED — these tests pin today's behaviour, they do not endorse it.**
    OVERHAUL.md §4 defines ``coverage = min(1, distinct_words / set_word_count)``, and the
    source implements exactly that, so there is no assertion to invert here. But §3 names
    this precise shape as a trap on the assessment side and guards against it there:
    measuring banked work against a count that moves means the hourly sweep re-scores and
    CONFISCATES points a student already earned, with no action on their part.

    The builder's guards are asymmetric. Removing a word from an assigned set is 409
    (``BuilderDeleteGuardTests``); ADDING one is unguarded, and only addition moves the
    denominator in the direction that costs the student. If a later change closes that
    gap, the second test below fails — and it should, pointing here.
    """

    def setUp(self):
        super().setUp()
        self._assign_as_homework()
        self.builder = self._as(self.admin)

    def _bank_a_perfect_run(self) -> VocabStudySession:
        session_id = self._start(mode="test").json()["id"]
        self._finish(
            session_id, [{"word_id": w.id, "correct": True} for w in self.words]
        )
        session = VocabStudySession.objects.get(pk=session_id)
        self.assertEqual(session.distinct_words, 3)
        self.assertAlmostEqual(session.scaled_accuracy(self.vset.items.count()), 100.0)
        return session

    def test_a_live_homework_set_can_still_be_grown_while_deleting_from_it_is_409(self):
        # The asymmetry itself, in one place: the guard exists and only covers shrinking.
        blocked = self.builder.delete(f"/api/vocabulary/admin/words/{self.words[0].id}/")
        self.assertEqual(blocked.status_code, 409, blocked.content)

        added = self.builder.post(
            f"/api/vocabulary/admin/sets/{self.vset.id}/words/",
            {"word": "delta", "definition": "meaning of delta"},
            format="json",
        )
        self.assertEqual(added.status_code, 201, added.content)
        self.assertEqual(self.vset.items.count(), 4)

    def test_growing_the_set_retroactively_devalues_a_run_already_finished(self):
        session = self._bank_a_perfect_run()

        self.builder.post(
            f"/api/vocabulary/admin/sets/{self.vset.id}/words/",
            {"word": "delta", "definition": "meaning of delta"},
            format="json",
        )

        # Nothing about the run changed — the student answered the same three words, all
        # correctly — but the score it carries into the homework percent has fallen by a
        # quarter, and the sweep will re-read it.
        session.refresh_from_db()
        self.assertEqual(session.distinct_words, 3)
        self.assertEqual(session.accuracy, 100.0)
        self.assertAlmostEqual(session.scaled_accuracy(self.vset.items.count()), 75.0)

    def test_the_finish_payload_reports_the_shrunken_coverage_too(self):
        # The student's own screen agrees with the scorer, so this is visible rather than
        # silent: an idempotent re-finish recomputes coverage against the set as it is now.
        session = self._bank_a_perfect_run()
        self.builder.post(
            f"/api/vocabulary/admin/sets/{self.vset.id}/words/",
            {"word": "delta", "definition": "meaning of delta"},
            format="json",
        )
        body = self._finish(
            session.pk, [{"word_id": self.words[0].id, "correct": True}]
        ).json()
        self.assertEqual(body["distinct_words"], 3)
        self.assertAlmostEqual(body["coverage"], 0.75)
