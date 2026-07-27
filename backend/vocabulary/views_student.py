"""
Student-facing vocabulary API (``/api/vocabulary/``).

Explicit ``APIView``s — this app has no ViewSet and no router, so ``urls.py`` wires each
path by hand (same idiom as the journals API).

Every endpoint is gated by ``IsAuthenticatedAndNotFrozen``. The previous generation of
this app used a bare ``IsAuthenticated``, which let a frozen student keep studying.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from classes.models import Assignment, ClassroomMembership
from users.permissions import IsAuthenticatedAndNotFrozen

from .models import (
    VocabHomework,
    VocabSection,
    VocabSet,
    VocabSetItem,
    VocabStudySession,
    VocabWord,
    VocabWordProgress,
)
from .serializers import (
    CustomSetWriteSerializer,
    SessionFinishSerializer,
    SessionStartSerializer,
    completed_set_ids,
    empty_progress,
    progress_buckets,
    progress_status_map,
    section_counts,
    section_progress_buckets,
    session_out,
    session_summary_out,
    set_detail_out,
    set_word_counts,
    word_search_out,
    words_by_set,
)

VOCAB_STUDENT_PERMS = [IsAuthenticatedAndNotFrozen]

WORD_SEARCH_DEFAULT_LIMIT = 40
WORD_SEARCH_MAX_LIMIT = 100


# --------------------------------------------------------------------------- helpers


def _member_classroom_ids(user) -> list[int]:
    """Classrooms the user still belongs to. Removal is a soft delete, so REMOVED is out."""
    return list(
        ClassroomMembership.objects.filter(user=user)
        .exclude(status=ClassroomMembership.STATUS_REMOVED)
        .values_list("classroom_id", flat=True)
    )


def _readable_set(user, pk: int) -> VocabSet | None:
    """
    A bank set in a PUBLISHED section, or a custom set the requester owns. Anything else
    is invisible — callers 404 rather than 403 so set ids can't be probed.
    """
    return (
        VocabSet.objects.select_related("section")
        .filter(Q(owner=user) | Q(section__is_published=True))
        .filter(pk=pk)
        .first()
    )


def _owned_set_or_404(user, pk: int) -> VocabSet:
    return get_object_or_404(VocabSet.objects.filter(owner=user), pk=pk)


def _replace_custom_set_items(vocab_set: VocabSet, word_ids: list[int]) -> None:
    """``word_ids`` REPLACES membership, in the order given."""
    VocabSetItem.objects.filter(vocab_set=vocab_set).delete()
    VocabSetItem.objects.bulk_create(
        [
            VocabSetItem(vocab_set=vocab_set, word_id=wid, order=idx)
            for idx, wid in enumerate(word_ids)
        ]
    )


def _validate_bank_word_ids(word_ids: list[int]) -> tuple[list[int], Response | None]:
    """Custom sets may only reference bank words in published sections."""
    if not word_ids:
        return [], None
    known = set(
        VocabWord.objects.filter(
            id__in=word_ids, section__is_published=True
        ).values_list("id", flat=True)
    )
    unknown = [wid for wid in word_ids if wid not in known]
    if unknown:
        return [], Response(
            {"word_ids": [f"Unknown word id(s): {', '.join(str(w) for w in unknown)}."]},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return word_ids, None


# --------------------------------------------------------------------------- sections


class SectionListView(APIView):
    """Published sections with their size and the requester's progress through them."""

    permission_classes = VOCAB_STUDENT_PERMS

    def get(self, request):
        sections = list(VocabSection.objects.filter(is_published=True))
        ids = [s.id for s in sections]
        set_counts, word_counts = section_counts(ids)
        buckets = section_progress_buckets(request.user, ids, word_counts)
        return Response(
            [
                {
                    "id": s.id,
                    "title": s.title,
                    "slug": s.slug,
                    "description": s.description,
                    "set_count": set_counts.get(s.id, 0),
                    "word_count": word_counts.get(s.id, 0),
                    "progress": buckets.get(s.id, empty_progress()),
                }
                for s in sections
            ]
        )


class SectionDetailView(APIView):
    """One published section and its sets, each with the requester's progress."""

    permission_classes = VOCAB_STUDENT_PERMS

    def get(self, request, pk: int):
        section = get_object_or_404(VocabSection, pk=pk, is_published=True)
        sets = list(VocabSet.objects.filter(section=section))
        set_ids = [s.id for s in sets]
        by_set = words_by_set(set_ids)
        all_word_ids = [w.id for words in by_set.values() for w in words]
        status_map = progress_status_map(request.user, all_word_ids)
        done = completed_set_ids(request.user, set_ids)
        return Response(
            {
                "id": section.id,
                "title": section.title,
                "slug": section.slug,
                "description": section.description,
                "sets": [
                    {
                        "id": s.id,
                        "title": s.title,
                        "order": s.order,
                        "word_count": len(by_set[s.id]),
                        "completed": s.id in done,
                        "progress": progress_buckets(
                            [w.id for w in by_set[s.id]], status_map
                        ),
                    }
                    for s in sets
                ],
            }
        )


class SetDetailView(APIView):
    """A bank set in a published section, or a custom set the requester owns."""

    permission_classes = VOCAB_STUDENT_PERMS

    def get(self, request, pk: int):
        vocab_set = _readable_set(request.user, pk)
        if vocab_set is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(set_detail_out(vocab_set, user=request.user))


class WordSearchView(APIView):
    """Bank-wide word search that feeds the custom-set builder."""

    permission_classes = VOCAB_STUDENT_PERMS

    def get(self, request):
        qs = VocabWord.objects.filter(section__is_published=True).select_related("section")
        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(word__icontains=q) | Q(definition__icontains=q))
        section_raw = (request.query_params.get("section") or "").strip()
        if section_raw.isdigit():
            qs = qs.filter(section_id=int(section_raw))

        limit_raw = (request.query_params.get("limit") or "").strip()
        limit = int(limit_raw) if limit_raw.isdigit() else WORD_SEARCH_DEFAULT_LIMIT
        limit = max(1, min(limit or WORD_SEARCH_DEFAULT_LIMIT, WORD_SEARCH_MAX_LIMIT))

        return Response([word_search_out(w) for w in qs.order_by("word", "id")[:limit]])


# --------------------------------------------------------------------------- custom sets


class MySetListCreateView(APIView):
    permission_classes = VOCAB_STUDENT_PERMS

    def get(self, request):
        sets = list(VocabSet.objects.filter(owner=request.user).order_by("-created_at", "-id"))
        set_ids = [s.id for s in sets]
        counts = set_word_counts(set_ids)
        done = completed_set_ids(request.user, set_ids)
        return Response(
            [
                {
                    "id": s.id,
                    "title": s.title,
                    "word_count": counts.get(s.id, 0),
                    "completed": s.id in done,
                    "created_at": s.created_at,
                }
                for s in sets
            ]
        )

    def post(self, request):
        ser = CustomSetWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        word_ids, denied = _validate_bank_word_ids(ser.validated_data["word_ids"])
        if denied is not None:
            return denied
        with transaction.atomic():
            vocab_set = VocabSet.objects.create(
                owner=request.user, title=ser.validated_data["title"]
            )
            _replace_custom_set_items(vocab_set, word_ids)
        return Response(
            set_detail_out(vocab_set, user=request.user), status=status.HTTP_201_CREATED
        )


class MySetDetailView(APIView):
    permission_classes = VOCAB_STUDENT_PERMS

    def patch(self, request, pk: int):
        vocab_set = _owned_set_or_404(request.user, pk)
        ser = CustomSetWriteSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        word_ids = None
        if "word_ids" in data:
            word_ids, denied = _validate_bank_word_ids(data["word_ids"])
            if denied is not None:
                return denied
        with transaction.atomic():
            if "title" in data:
                vocab_set.title = data["title"]
                vocab_set.save(update_fields=["title", "updated_at"])
            if word_ids is not None:
                _replace_custom_set_items(vocab_set, word_ids)
        return Response(set_detail_out(vocab_set, user=request.user))

    def delete(self, request, pk: int):
        vocab_set = _owned_set_or_404(request.user, pk)
        vocab_set.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- homework


class HomeworkListView(APIView):
    """Assigned vocabulary sets, grouped by the classroom assignment that carries them."""

    permission_classes = VOCAB_STUDENT_PERMS

    def get(self, request):
        links = list(
            VocabHomework.objects.filter(
                classroom_id__in=_member_classroom_ids(request.user),
                assignment__status=Assignment.STATUS_PUBLISHED,
            )
            .select_related("assignment", "classroom", "vocab_set", "vocab_set__section")
            .order_by(
                F("assignment__due_at").asc(nulls_last=True),
                "-assignment__created_at",
                "assignment_id",
                "id",
            )
        )
        set_ids = [l.vocab_set_id for l in links]
        counts = set_word_counts(set_ids)
        done = completed_set_ids(request.user, set_ids)

        groups: dict[int, dict] = {}
        for link in links:
            assignment = link.assignment
            group = groups.get(assignment.id)
            if group is None:
                group = {
                    "assignment_id": assignment.id,
                    "assignment_title": assignment.title,
                    "classroom_id": link.classroom_id,
                    "classroom_name": link.classroom.name,
                    "due_at": assignment.due_at,
                    "sets": [],
                }
                groups[assignment.id] = group
            group["sets"].append(
                {
                    "id": link.vocab_set_id,
                    "title": link.vocab_set.title,
                    "section_title": (
                        link.vocab_set.section.title if link.vocab_set.section_id else ""
                    ),
                    "word_count": counts.get(link.vocab_set_id, 0),
                    "completed": link.vocab_set_id in done,
                }
            )
        return Response(list(groups.values()))


# --------------------------------------------------------------------------- sessions


class SessionCreateView(APIView):
    permission_classes = VOCAB_STUDENT_PERMS

    def post(self, request):
        ser = SessionStartSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        vocab_set = _readable_set(request.user, ser.validated_data["set_id"])
        if vocab_set is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        # Bind the run to the homework that assigned it when there is one: the classroom
        # reconcile path refuses to detach a VocabHomework that already has sessions, so
        # this is what stops a teacher's edit from erasing work a student already did.
        homework = None
        if not vocab_set.is_custom:
            homework = (
                VocabHomework.objects.filter(
                    vocab_set=vocab_set,
                    classroom_id__in=_member_classroom_ids(request.user),
                    assignment__status=Assignment.STATUS_PUBLISHED,
                )
                .order_by("-created_at", "-id")
                .first()
            )

        session = VocabStudySession.objects.create(
            user=request.user,
            vocab_set=vocab_set,
            mode=ser.validated_data["mode"],
            homework=homework,
        )
        return Response(session_out(session), status=status.HTTP_201_CREATED)


class SessionFinishView(APIView):
    """
    Grade one study run and fold its answers into the student's word progress.

    Safe to call twice: a session that already has ``completed_at`` returns its existing
    summary untouched instead of double-applying progress. The modes flush on unload, so
    a duplicate finish is a normal event, not an error.
    """

    permission_classes = VOCAB_STUDENT_PERMS

    def post(self, request, pk: int):
        session = get_object_or_404(
            VocabStudySession.objects.select_related("vocab_set"), pk=pk, user=request.user
        )
        if session.completed_at is not None:
            return Response(session_summary_out(session, user=request.user))

        ser = SessionFinishSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        results = ser.validated_data["results"]
        duration_ms = ser.validated_data.get("duration_ms") or 0

        set_word_ids = set(
            VocabSetItem.objects.filter(vocab_set_id=session.vocab_set_id).values_list(
                "word_id", flat=True
            )
        )
        # Answers for words that are not in the set are dropped outright — they can neither
        # move progress nor pad the score.
        graded = [r for r in results if r["word_id"] in set_word_ids]

        now = timezone.now()
        with transaction.atomic():
            # Re-read under a row lock so two concurrent finishes cannot both pass the
            # completed_at guard. No select_related here: on Postgres, FOR UPDATE against
            # a nullable-FK outer join errors out.
            locked = VocabStudySession.objects.select_for_update().get(pk=session.pk)
            if locked.completed_at is not None:
                return Response(session_summary_out(session, user=request.user))

            # One row per distinct word, mutated in answer order (streaks are sequential),
            # written once at the end.
            rows: dict[int, VocabWordProgress] = {}
            for entry in graded:
                progress = rows.get(entry["word_id"])
                if progress is None:
                    progress, _created = VocabWordProgress.objects.get_or_create(
                        user=request.user, word_id=entry["word_id"]
                    )
                    rows[entry["word_id"]] = progress
                progress.record(correct=entry["correct"], at=now)
            for progress in rows.values():
                progress.save(
                    update_fields=[
                        "status",
                        "correct_count",
                        "wrong_count",
                        "streak",
                        "last_reviewed_at",
                        "updated_at",
                    ]
                )

            locked.finish(
                correct=sum(1 for r in graded if r["correct"]),
                total=len(graded),
                duration_ms=duration_ms,
                at=now,
            )
            locked.save(
                update_fields=[
                    "completed_at",
                    "correct_count",
                    "total_count",
                    "duration_ms",
                    "accuracy",
                ]
            )

        locked.vocab_set = session.vocab_set
        return Response(session_summary_out(locked, user=request.user))
