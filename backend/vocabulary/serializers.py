"""
Vocabulary serializers.

Read payloads are hand-rolled dicts. Every student-facing shape carries the *requesting*
student's per-word progress, which a ModelSerializer can only produce with one query per
word; the builders below take pre-fetched maps instead, so a list endpoint costs a fixed
number of queries no matter how many sections / sets / words it returns.

Write payloads go through small ``Serializer`` classes so no view hand-validates.
"""

from __future__ import annotations

from django.db.models import Count
from rest_framework import serializers

from .models import (
    VocabSet,
    VocabSetItem,
    VocabStudySession,
    VocabWord,
    VocabWordProgress,
)


# --------------------------------------------------------------------------- progress


def empty_progress() -> dict:
    return {"new": 0, "learning": 0, "mastered": 0, "total": 0}


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
    """New/Learning/Mastered counts over an explicit word list."""
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
    student has not touched yet".
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
        bucket["new"] = max(0, bucket["total"] - bucket["learning"] - bucket["mastered"])
    return buckets


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
        "completed": vocab_set.is_completed_by(user),
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
    repaint the New/Learning/Mastered filter without a second round trip — and so an
    idempotent replay reports the same numbers as the original call.
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
        "duration_ms": session.duration_ms,
        "set_completed": session.vocab_set.is_completed_by(user),
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

    title = serializers.CharField(max_length=200)
    word_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)

    def validate_word_ids(self, value):
        seen: set[int] = set()
        ordered: list[int] = []
        for wid in value:
            if wid not in seen:
                seen.add(wid)
                ordered.append(wid)
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

    def validate_results(self, value):
        if len(value) > self.MAX_RESULTS:
            raise serializers.ValidationError(
                f"A session cannot record more than {self.MAX_RESULTS} answers."
            )
        return value
