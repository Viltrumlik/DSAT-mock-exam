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
from rest_framework import serializers, status
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
    mastered_modes_by_set,
    mastery_out,
    section_counts,
    section_mastery,
    section_progress_buckets,
    session_out,
    session_summary_out,
    set_detail_out,
    set_progress_buckets,
    set_word_counts,
    word_search_out,
)

VOCAB_STUDENT_PERMS = [IsAuthenticatedAndNotFrozen]

WORD_SEARCH_DEFAULT_LIMIT = 40
WORD_SEARCH_MAX_LIMIT = 100

# A student curates their own study lists; past a couple of hundred they are hoarding,
# not studying, and every list endpoint pays for it.
MAX_CUSTOM_SETS_PER_STUDENT = 200


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
    A bank set in a PUBLISHED section, a custom set the requester owns, or a set assigned
    to the requester as live homework. Anything else is invisible — callers 404 rather
    than 403 so set ids can't be probed.

    Homework outranks the publish flag on purpose: unpublishing hides a section from the
    bank browse, it does not revoke work already assigned. Without this an author who
    followed the section-delete guard's own advice ("unpublish the section instead")
    would strand every classroom that had the set as homework.
    """
    return (
        VocabSet.objects.select_related("section")
        .filter(
            Q(owner=user)
            | Q(section__is_published=True)
            | Q(
                homework_links__classroom_id__in=_member_classroom_ids(user),
                homework_links__assignment__status=Assignment.STATUS_PUBLISHED,
            )
        )
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


def _mastered_set_counts_by_section(user, section_ids) -> dict[int, int]:
    """``{section_id: how many of its sets this student has fully mastered}``.

    Two grouped queries for the whole hub rather than one per section: the set ids and
    their word counts come back together, and :func:`mastered_modes_by_set` answers every
    set in a single pass.
    """
    if not section_ids:
        return {}
    rows = list(
        VocabSet.objects.filter(section_id__in=section_ids).values_list("id", "section_id")
    )
    set_ids = [sid for sid, _ in rows]
    counts = set_word_counts(set_ids)
    modes = mastered_modes_by_set(user, set_ids, counts)
    out = {sid: 0 for sid in section_ids}
    for set_id, section_id in rows:
        if mastery_out(modes.get(set_id, set()), word_count=counts.get(set_id, 0))["is_mastered"]:
            out[section_id] = out.get(section_id, 0) + 1
    return out


# --------------------------------------------------------------------------- sections


class SectionListView(APIView):
    """Published sections with their size and the requester's progress through them."""

    permission_classes = VOCAB_STUDENT_PERMS

    def get(self, request):
        sections = list(VocabSection.objects.filter(is_published=True))
        ids = [s.id for s in sections]
        set_counts, word_counts = section_counts(ids)
        buckets = section_progress_buckets(request.user, ids, word_counts)
        mastered_by_section = _mastered_set_counts_by_section(request.user, ids)
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
                    # The section's own bar: how many of its sets are fully mastered.
                    "mastery": section_mastery(
                        mastered_by_section.get(s.id, 0), set_counts.get(s.id, 0)
                    ),
                }
                for s in sections
            ]
        )


class SectionDetailView(APIView):
    """
    One published section and its sets, each with the requester's progress.

    The section-level ``word_count`` / ``progress`` come from the SAME helpers the hub
    list uses, so the two screens cannot disagree: a word that appears in two sets is one
    word in the section and two items across the set cards.
    """

    permission_classes = VOCAB_STUDENT_PERMS

    def get(self, request, pk: int):
        section = get_object_or_404(VocabSection, pk=pk, is_published=True)
        sets = list(VocabSet.objects.filter(section=section))
        set_ids = [s.id for s in sets]
        # Grouped counts, never the words themselves: a set card needs a total and three
        # bucket numbers, and a section can hold thousands of words.
        counts = set_word_counts(set_ids)
        buckets = set_progress_buckets(request.user, set_ids, counts)
        done = completed_set_ids(request.user, set_ids)
        modes = mastered_modes_by_set(request.user, set_ids, counts)
        mastery = {
            s.id: mastery_out(modes.get(s.id, set()), word_count=counts.get(s.id, 0))
            for s in sets
        }
        _set_counts, word_counts = section_counts([section.id])
        section_buckets = section_progress_buckets(request.user, [section.id], word_counts)
        return Response(
            {
                "id": section.id,
                "title": section.title,
                "slug": section.slug,
                "description": section.description,
                "word_count": word_counts.get(section.id, 0),
                "progress": section_buckets.get(section.id, empty_progress()),
                # Derived from the very set cards below, so the header and the grid can
                # never disagree about how many sets are done.
                "mastery": section_mastery(
                    sum(1 for m in mastery.values() if m["is_mastered"]), len(sets)
                ),
                "sets": [
                    {
                        "id": s.id,
                        "title": s.title,
                        "order": s.order,
                        "word_count": counts.get(s.id, 0),
                        "completed": s.id in done,
                        "progress": buckets.get(s.id, empty_progress()),
                        "mastery": mastery[s.id],
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
        modes = mastered_modes_by_set(request.user, set_ids, counts)
        return Response(
            [
                {
                    "id": s.id,
                    "title": s.title,
                    "word_count": counts.get(s.id, 0),
                    "completed": s.id in done,
                    "mastery": mastery_out(
                        modes.get(s.id, set()), word_count=counts.get(s.id, 0)
                    ),
                    "created_at": s.created_at,
                }
                for s in sets
            ]
        )

    def post(self, request):
        ser = CustomSetWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        owned = VocabSet.objects.filter(owner=request.user).count()
        if owned >= MAX_CUSTOM_SETS_PER_STUDENT:
            return Response(
                {
                    "detail": (
                        f"You already have {MAX_CUSTOM_SETS_PER_STUDENT} sets. Delete one "
                        "before creating another."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
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
        modes = mastered_modes_by_set(request.user, set_ids, counts)

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
                    # The same block the set page shows, so a student can see from the
                    # homework card how many of the four games are still owed.
                    "mastery": mastery_out(
                        modes.get(link.vocab_set_id, set()),
                        word_count=counts.get(link.vocab_set_id, 0),
                    ),
                }
            )
        return Response(list(groups.values()))


# --------------------------------------------------------------------------- sessions


class SessionStartWithBindingSerializer(SessionStartSerializer):
    """
    ``set_id`` / ``mode``, plus the launcher's claim about WHICH homework this run is for.

    Both ids are optional and either identifies the same thing: ``assignment_id`` is the
    group ``GET homework/`` returns, ``homework_id`` the link row inside it. Optional
    because every client shipped before this field sends neither — a request without them
    is not an error, and a run bound to nothing is a legitimate row (self-study).
    """

    assignment_id = serializers.IntegerField(
        required=False, allow_null=True, min_value=1
    )
    homework_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)


def _live_homework_links(user, vocab_set):
    """
    Links carrying this set that the requester could have launched from.

    Three filters, each a fact about the requester rather than about the id they sent:
    the set is THIS set, the classroom is one they still belong to (removal is a soft
    delete, so ``_member_classroom_ids`` excludes REMOVED), and the assignment is
    PUBLISHED — a draft is invisible to a student, so it cannot be where they started.
    """
    return VocabHomework.objects.filter(
        vocab_set=vocab_set,
        classroom_id__in=_member_classroom_ids(user),
        assignment__status=Assignment.STATUS_PUBLISHED,
    )


def _bind_homework(user, vocab_set, data) -> tuple[VocabHomework | None, Response | None]:
    """
    Which homework a study run belongs to.

    Binding matters beyond bookkeeping: the classroom reconcile path refuses to detach a
    VocabHomework that already has sessions, so this row is what stops a teacher's edit
    from erasing work a student already did.

    The supplied ids are a CLAIM, never a fact. Each is re-resolved against the
    requester's own live memberships and against THIS set, so an id belonging to another
    classroom's homework — or to a homework carrying a different set — binds nothing.

    A supplied id that resolves to nothing is refused rather than quietly falling back to
    the guess below: the guess is what writes wrong-homework rows, and doing it silently
    behind a client that asked for something specific is how the bug got here.
    """
    assignment_id = data.get("assignment_id")
    homework_id = data.get("homework_id")

    if assignment_id or homework_id:
        links = _live_homework_links(user, vocab_set)
        if assignment_id:
            links = links.filter(assignment_id=assignment_id)
        if homework_id:
            links = links.filter(pk=homework_id)
        # Send both and they must agree: two contradicting ids narrow to no row, which is
        # the honest answer to a client that cannot say what it launched from.
        link = links.order_by("-created_at", "-id").first()
        if link is None:
            return None, Response(
                {"detail": "That homework is not assigned to you for this set."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return link, None

    if vocab_set.is_custom:
        return None, None

    # Nothing was claimed, so what follows is a GUESS and not a fact. The newest live link
    # is merely the most likely one: a set assigned to two classrooms, or re-assigned for
    # revision, has several and only the client knows which one the student opened. This
    # column is guessed often enough that ``rewards.homework`` deliberately stopped reading
    # it, so treat it as a hint about provenance and never as an authority.
    #
    # Classwork carriers are excluded from the guess. Classwork is deadline-less and paid
    # only by a teacher's hand, so a link minted for a lesson is never the homework a
    # student was "doing" — naming it here is a wrong answer where null is an honest
    # "we do not know". An explicitly claimed classwork id is a different matter and is
    # honoured above: then it is what the student actually opened.
    return (
        _live_homework_links(user, vocab_set)
        .exclude(assignment__category=Assignment.CATEGORY_CLASSWORK)
        .order_by("-created_at", "-id")
        .first()
    ), None


class SessionCreateView(APIView):
    permission_classes = VOCAB_STUDENT_PERMS

    def post(self, request):
        ser = SessionStartWithBindingSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        vocab_set = _readable_set(request.user, ser.validated_data["set_id"])
        if vocab_set is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        homework, denied = _bind_homework(request.user, vocab_set, ser.validated_data)
        if denied is not None:
            return denied

        session = VocabStudySession.objects.create(
            user=request.user,
            vocab_set=vocab_set,
            mode=ser.validated_data["mode"],
            homework=homework,
        )
        return Response(session_out(session), status=status.HTTP_201_CREATED)


class SessionFinishView(APIView):
    """
    Fold one flush of a study run into the student's word progress.

    The body carries only the answers the client has not sent yet, so the server APPENDS:
    the session's counts accumulate across flushes and ``duration_ms`` — a running clock,
    not a delta — keeps the largest value reported. ``distinct_words`` accumulates too, but
    as a UNION: the same word can arrive in two flushes (flashcards re-drill the missed
    pile), and a word answered twice is still one word of the set covered.

    ``partial: true`` is the flush a mode fires when the student navigates away mid-run.
    It records the answers but leaves ``completed_at`` unset, so 20 of 25 flashcards are
    banked without the set counting as completed.

    Safe to call twice: a session that already has ``completed_at`` returns its existing
    summary and ignores the body entirely instead of double-applying progress. The modes
    flush on unload, so a duplicate finish is a normal event, not an error.
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
        is_partial = ser.validated_data.get("partial", False)

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
                progress.record(correct=entry["correct"], mode=session.mode, at=now)
            for progress in rows.values():
                progress.save(update_fields=list(VocabWordProgress.RECORD_FIELDS))

            locked.record_batch(
                correct=sum(1 for r in graded if r["correct"]),
                total=len(graded),
                duration_ms=duration_ms,
            )
            # Folded into ``locked``, never ``session``: the union has to build on the row
            # as it is in the database, or a flush that raced another would drop its words.
            locked.record_distinct_words(entry["word_id"] for entry in graded)
            update_fields = [
                *VocabStudySession.BATCH_FIELDS,
                *VocabStudySession.DISTINCT_FIELDS,
            ]
            if not is_partial:
                locked.complete(at=now)
                update_fields.append("completed_at")
            locked.save(update_fields=update_fields)

        locked.vocab_set = session.vocab_set
        return Response(session_summary_out(locked, user=request.user))
