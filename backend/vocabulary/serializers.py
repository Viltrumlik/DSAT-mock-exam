"""
Vocabulary serializers.

Read payloads are hand-rolled dicts. Every student-facing shape carries the *requesting*
student's per-word progress, which a ModelSerializer can only produce with one query per
word; the builders below take pre-fetched maps instead, so a list endpoint costs a fixed
number of queries no matter how many sections / sets / words it returns.

Write payloads go through small ``Serializer`` classes so no view hand-validates.
"""

from __future__ import annotations

from django.db.models import Count, F
from rest_framework import serializers

from .models import (
    STUDY_MODES,
    VocabSet,
    VocabSetItem,
    VocabStudySession,
    VocabWord,
    VocabWordProgress,
)


# --------------------------------------------------------------------------- progress


def empty_progress() -> dict:
    return {"new": 0, "mastered": 0, "total": 0}


def progress_status_map(user, word_ids) -> dict[int, str]:
    """
    ``{word_id: status}`` for the words this student has actually answered.

    Words with no row are simply absent — callers default them to ``new`` rather than
    materializing a progress row the student has not earned yet.
    """
    if not word_ids:
        return {}
    return dict(
        VocabWordProgress.objects.filter(user=user, word_id__in=word_ids).values_list(
            "word_id", "status"
        )
    )


def progress_buckets(word_ids, status_map: dict[int, str]) -> dict:
    """New/Mastered counts over an explicit word list."""
    counts = empty_progress()
    for wid in word_ids:
        counts[status_map.get(wid, VocabWordProgress.STATUS_NEW)] += 1
    counts["total"] = len(word_ids)
    return counts


def section_progress_buckets(user, section_ids, word_totals: dict[int, int]) -> dict[int, dict]:
    """
    Per-section progress buckets in ONE grouped query.

    A section can hold thousands of words, so this counts by status in SQL instead of
    pulling every word id back to derive ``new`` — which is simply "everything the
    student has not mastered yet".
    """
    buckets = {sid: empty_progress() for sid in section_ids}
    for sid, total in word_totals.items():
        if sid in buckets:
            buckets[sid]["total"] = total
    if not section_ids:
        return buckets
    rows = (
        VocabWordProgress.objects.filter(user=user, word__section_id__in=section_ids)
        .values("word__section_id", "status")
        .order_by()
        .annotate(n=Count("id"))
    )
    for row in rows:
        bucket = buckets.get(row["word__section_id"])
        if bucket is not None and row["status"] in bucket:
            bucket[row["status"]] += row["n"]
    for bucket in buckets.values():
        bucket["new"] = max(0, bucket["total"] - bucket["mastered"])
    return buckets


def set_progress_buckets(user, vocab_set_ids, word_totals: dict[int, int]) -> dict[int, dict]:
    """
    Per-set progress buckets in ONE grouped query — the set-level twin of
    :func:`section_progress_buckets`.

    Joins progress rows to their set through ``VocabSetItem`` so a section's set cards
    cost O(sets) queries instead of materializing every word in the section. As above,
    ``new`` is derived rather than counted: it is whatever the student has not touched.
    """
    buckets = {sid: empty_progress() for sid in vocab_set_ids}
    for sid, total in word_totals.items():
        if sid in buckets:
            buckets[sid]["total"] = total
    if not vocab_set_ids:
        return buckets
    # ``order_by()`` is load-bearing: VocabSetItem carries a default ordering and Django
    # folds ordering columns into the GROUP BY, which would split each count per item.
    rows = (
        VocabWordProgress.objects.filter(
            user=user, word__set_items__vocab_set_id__in=vocab_set_ids
        )
        .values("word__set_items__vocab_set_id", "status")
        .order_by()
        .annotate(n=Count("id"))
    )
    for row in rows:
        bucket = buckets.get(row["word__set_items__vocab_set_id"])
        if bucket is not None and row["status"] in bucket:
            bucket[row["status"]] += row["n"]
    for bucket in buckets.values():
        bucket["new"] = max(0, bucket["total"] - bucket["mastered"])
    return buckets


# --------------------------------------------------------------------------- mastery


def empty_mastery() -> dict:
    return mastery_out(set(), word_count=0)


def mastery_out(modes, *, word_count: int) -> dict:
    """One set's mastery, as the progress bar and the per-game 0/1 badges read it.

    ``percent`` is whole games, never a partial one: a quarter of the bar appears the
    moment a game is mastered and not a pixel before, which is the whole point of the
    rule — 80% of the way through Speed is not 20% of Speed.
    """
    earned = [m for m in STUDY_MODES if m in set(modes or ())]
    total = len(STUDY_MODES)
    return {
        "modes": {m: (m in earned) for m in STUDY_MODES},
        "mastered_modes": len(earned),
        "total_modes": total,
        "percent": round((len(earned) / total) * 100) if total else 0,
        # An empty set has nothing to master; without this guard a set with no words would
        # report itself mastered the moment it had no games left to fail.
        "is_mastered": bool(word_count) and len(earned) == total,
    }


def mastered_modes_by_set(user, vocab_set_ids, word_totals: dict[int, int]) -> dict[int, set[str]]:
    """``{set_id: {games mastered}}`` for many sets in ONE query.

    A game is mastered by a single clean run of it — every word in the set answered, none
    of them wrong — and once earned it stays earned. It is deliberately not "the first
    run", the rule the homework score used to apply to accuracy: a student who muddles
    their first Speed round can go back and race it properly, which is the behaviour the
    word "mastered" promises.

    The perfect-run test is pushed into SQL as far as it goes (``correct_count`` equals
    ``total_count``, and the run answered something); only the per-set coverage comparison
    is left to Python, because its denominator differs per row.
    """
    out: dict[int, set[str]] = {sid: set() for sid in vocab_set_ids}
    if not vocab_set_ids:
        return out
    rows = (
        VocabStudySession.objects.filter(
            user=user,
            vocab_set_id__in=vocab_set_ids,
            completed_at__isnull=False,
            total_count__gt=0,
            correct_count=F("total_count"),
        )
        .values_list("vocab_set_id", "mode", "distinct_words")
    )
    for sid, mode, distinct in rows:
        size = word_totals.get(sid, 0)
        if size and distinct >= size and sid in out:
            out[sid].add(mode)
    return out


def section_mastery(mastered_sets: int, total_sets: int) -> dict:
    """A section's own bar: how many of its sets are fully mastered.

    The section rolls up the SETS rather than re-counting words so that every bar in the
    feature answers the same question — "how much of this is finished" — at its own scale.
    """
    return {
        "mastered_sets": mastered_sets,
        "total_sets": total_sets,
        "percent": round((mastered_sets / total_sets) * 100) if total_sets else 0,
    }


# --------------------------------------------------------------------------- counts


def section_counts(section_ids) -> tuple[dict[int, int], dict[int, int]]:
    """``(set_count_by_section, word_count_by_section)`` in two grouped queries.

    Deliberately NOT a double ``Count(..., distinct=True)`` annotation: that joins sets
    and words in the same statement and materializes their cross product before the
    DISTINCT collapses it.
    """
    if not section_ids:
        return {}, {}
    set_counts = {
        r["section_id"]: r["n"]
        for r in VocabSet.objects.filter(section_id__in=section_ids)
        .values("section_id")
        .order_by()
        .annotate(n=Count("id"))
    }
    word_counts = {
        r["section_id"]: r["n"]
        for r in VocabWord.objects.filter(section_id__in=section_ids)
        .values("section_id")
        .order_by()
        .annotate(n=Count("id"))
    }
    return set_counts, word_counts


def set_word_counts(vocab_set_ids) -> dict[int, int]:
    """``{set_id: word_count}`` in one grouped query."""
    if not vocab_set_ids:
        return {}
    return {
        r["vocab_set_id"]: r["n"]
        for r in VocabSetItem.objects.filter(vocab_set_id__in=vocab_set_ids)
        .values("vocab_set_id")
        .order_by()
        .annotate(n=Count("id"))
    }


def completed_set_ids(user, vocab_set_ids) -> set[int]:
    """The subset of ``vocab_set_ids`` this student has finished ANY study mode on."""
    if not vocab_set_ids:
        return set()
    return set(
        VocabStudySession.objects.filter(
            user=user, vocab_set_id__in=vocab_set_ids, completed_at__isnull=False
        ).values_list("vocab_set_id", flat=True)
    )


def words_by_set(vocab_set_ids) -> dict[int, list[VocabWord]]:
    """``{set_id: [VocabWord in item order]}`` for many sets in one query."""
    by_set: dict[int, list[VocabWord]] = {sid: [] for sid in vocab_set_ids}
    if not vocab_set_ids:
        return by_set
    items = (
        VocabSetItem.objects.filter(vocab_set_id__in=vocab_set_ids)
        .select_related("word")
        .order_by("vocab_set_id", "order", "id")
    )
    for item in items:
        by_set[item.vocab_set_id].append(item.word)
    return by_set


# --------------------------------------------------------------------------- read shapes


def word_out(word: VocabWord, status: str) -> dict:
    return {
        "id": word.id,
        "word": word.word,
        "definition": word.definition,
        "part_of_speech": word.part_of_speech,
        "example": word.example,
        "synonyms": list(word.synonyms or []),
        "status": status,
    }


def word_search_out(word: VocabWord) -> dict:
    """The bank-search shape that feeds the custom-set builder (no per-word progress)."""
    return {
        "id": word.id,
        "word": word.word,
        "definition": word.definition,
        "part_of_speech": word.part_of_speech,
        "section_id": word.section_id,
        "section_title": word.section.title,
    }


def set_mastery(user, vocab_set: VocabSet, word_count: int) -> dict:
    """One set's mastery block. The single-set form of :func:`mastered_modes_by_set`."""
    modes = mastered_modes_by_set(user, [vocab_set.pk], {vocab_set.pk: word_count})
    return mastery_out(modes.get(vocab_set.pk, set()), word_count=word_count)


def set_detail_out(vocab_set: VocabSet, *, user, words: list[VocabWord] | None = None) -> dict:
    """Full set payload — words in study order, each tagged with the student's status."""
    if words is None:
        words = words_by_set([vocab_set.pk])[vocab_set.pk]
    word_ids = [w.id for w in words]
    status_map = progress_status_map(user, word_ids)
    return {
        "id": vocab_set.pk,
        "title": vocab_set.title,
        "is_custom": vocab_set.is_custom,
        "section": (
            {"id": vocab_set.section_id, "title": vocab_set.section.title}
            if vocab_set.section_id
            else None
        ),
        "word_count": len(words),
        # ``completed`` and ``mastery`` answer two different questions and both are shown:
        # completed is "this student has finished a game here at all", mastery is "which
        # games have been played clean". A set can be completed and 0% mastered.
        "completed": vocab_set.is_completed_by(user),
        "mastery": set_mastery(user, vocab_set, len(words)),
        "words": [
            word_out(w, status_map.get(w.id, VocabWordProgress.STATUS_NEW)) for w in words
        ],
    }


def session_out(session: VocabStudySession) -> dict:
    return {
        "id": session.pk,
        "set_id": session.vocab_set_id,
        "mode": session.mode,
        "started_at": session.started_at,
    }


def session_summary_out(session: VocabStudySession, *, user) -> dict:
    """
    The finish payload. ``progress`` is recomputed over the SET's words so the client can
    repaint the New/Mastered filter without a second round trip — and so an idempotent
    replay reports the same numbers as the original call.
    """
    word_ids = list(
        VocabSetItem.objects.filter(vocab_set_id=session.vocab_set_id)
        .order_by("order", "id")
        .values_list("word_id", flat=True)
    )
    status_map = progress_status_map(user, word_ids)
    return {
        "id": session.pk,
        "mode": session.mode,
        "correct_count": session.correct_count,
        "total_count": session.total_count,
        "accuracy": session.accuracy,
        # Reported alongside the raw accuracy because the two answer different questions —
        # how well the run went, and how much of the set it actually reached. The set size
        # is already in hand here, so neither costs a query.
        "distinct_words": session.distinct_words,
        "coverage": round(session.coverage(len(word_ids)), 4),
        "duration_ms": session.duration_ms,
        "set_completed": session.vocab_set.is_completed_by(user),
        # Whether THIS run mastered its game, so the end-of-round screen can say so without
        # re-deriving the rule client-side. Recomputed from the stored row rather than from
        # what the client just sent, so a replayed finish reports the same verdict.
        "mode_mastered": session.is_perfect(len(word_ids)),
        "mastery": set_mastery(user, session.vocab_set, len(word_ids)),
        "progress": progress_buckets(word_ids, status_map),
    }


# --------------------------------------------------------------------------- write shapes


class VocabSectionWriteSerializer(serializers.Serializer):
    """Builder section create/update. ``slug`` is derived from the title when omitted."""

    title = serializers.CharField(max_length=200)
    slug = serializers.SlugField(max_length=220, required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)
    order = serializers.IntegerField(required=False, min_value=0)
    is_published = serializers.BooleanField(required=False)


class VocabSetWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    order = serializers.IntegerField(required=False, min_value=0)


class VocabWordWriteSerializer(serializers.Serializer):
    """Also the per-row validator for the CSV importer — one definition of a valid word."""

    word = serializers.CharField(max_length=120)
    definition = serializers.CharField()
    part_of_speech = serializers.ChoiceField(
        choices=[c[0] for c in VocabWord.PART_CHOICES], required=False
    )
    example = serializers.CharField(required=False, allow_blank=True)
    synonyms = serializers.ListField(
        child=serializers.CharField(allow_blank=True), required=False
    )

    def validate_synonyms(self, value):
        return [str(s).strip() for s in value if str(s).strip()]


class CustomSetWriteSerializer(serializers.Serializer):
    """A student's own set. ``word_ids`` REPLACES membership, so order is meaningful."""

    # A set targets 25 words; the cap only stops a payload that would have the student
    # rewrite every set item on every PATCH.
    MAX_WORDS = 500

    title = serializers.CharField(max_length=200)
    word_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)

    def validate_word_ids(self, value):
        seen: set[int] = set()
        ordered: list[int] = []
        for wid in value:
            if wid not in seen:
                seen.add(wid)
                ordered.append(wid)
        # Counted after de-duplication: the cap is on set SIZE, not on payload length.
        if len(ordered) > self.MAX_WORDS:
            raise serializers.ValidationError(
                f"A set cannot hold more than {self.MAX_WORDS} words."
            )
        return ordered


class SessionStartSerializer(serializers.Serializer):
    set_id = serializers.IntegerField()
    mode = serializers.ChoiceField(choices=[c[0] for c in VocabStudySession.MODE_CHOICES])


class SessionResultSerializer(serializers.Serializer):
    word_id = serializers.IntegerField()
    correct = serializers.BooleanField()


class SessionFinishSerializer(serializers.Serializer):
    # Flashcards loop over the words the student got wrong, so `results` legitimately
    # holds more entries than the set has words. The cap only stops an abusive payload.
    MAX_RESULTS = 2000

    duration_ms = serializers.IntegerField(min_value=0, required=False, default=0)
    results = SessionResultSerializer(many=True)
    # A flush the mode fires on unload: record these answers, but do NOT complete the
    # run. Absent means the mode ran to completion, which is the finishing call.
    partial = serializers.BooleanField(required=False, default=False)

    def validate_results(self, value):
        if len(value) > self.MAX_RESULTS:
            raise serializers.ValidationError(
                f"A session cannot record more than {self.MAX_RESULTS} answers."
            )
        return value
