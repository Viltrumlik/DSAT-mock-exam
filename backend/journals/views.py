"""Journal REST API (admin-only).

Explicit APIViews (matching the builder/admin idiom); urls.py registers bulk/collection
paths before ``<int:pk>`` catch-alls. All views are gated by ``CanManageJournals`` — global
staff only (teachers must never author journals).
"""

from __future__ import annotations

import json

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from access.permissions import CanManageJournals
from classes.link_utils import clean_external_urls, first_url, resolve_links
from classes.media_uploads import presign_video_put
from users.permissions import IsAuthenticatedAndNotFrozen

from . import services, structure
from .models import (
    Journal,
    JournalClasswork,
    JournalClassworkAssessment,
    JournalClassworkAttachment,
    JournalLesson,
    JournalLessonAssessment,
    JournalLessonAttachment,
    JournalRoadmap,
    JournalRoadmapSection,
)
from .serializers import (
    JournalClassworkSerializer,
    JournalClassworkWriteSerializer,
    JournalDetailSerializer,
    JournalLessonDetailSerializer,
    JournalLessonSummarySerializer,
    JournalListSerializer,
    JournalRoadmapSectionSerializer,
    JournalRoadmapSerializer,
    JournalRoadmapWriteSerializer,
)

JOURNAL_PERMS = [IsAuthenticatedAndNotFrozen, CanManageJournals]
_WRITE_PARSERS = [MultiPartParser, FormParser, JSONParser]

_TRUTHY = {"1", "true", "True", "yes", "on"}


# --------------------------------------------------------------------------- helpers

def _links_lenient(list_raw, single_raw):
    """Best-effort link normalization for internal copy/import paths.

    Prefers the list payload, falls back to the legacy single value, and drops (rather
    than 400s on) an invalid URL — the caller is a trusted export/copy, not a user form.
    """
    raw = list_raw if list_raw is not None else single_raw
    try:
        return clean_external_urls(raw)
    except DjangoValidationError:
        return []


def _video_lenient(raw):
    """Best-effort single video-URL normalization for internal copy/import paths."""
    from classes.link_utils import normalize_one

    try:
        return normalize_one(raw or "")
    except DjangoValidationError:
        return ""


def apply_journal_video(obj, request, *, url_field, file_field):
    """Set a session's lesson video from a save payload, one deterministic way.

    Precedence: an uploaded file (``video_key``) wins, then explicit removal
    (``remove_video``), then a link (``video_url``). A file and a link never coexist — the
    one just set clears the other. Only acts when one of those keys is present; otherwise
    leaves both fields untouched (partial-PATCH safe). Returns the changed field names.
    Raises ``DjangoValidationError`` on an invalid link.
    """
    from classes.link_utils import normalize_one
    from classes.media_uploads import resolve_video_key

    truthy = {"1", "true", "yes", "on"}
    changed: set[str] = set()
    key = (request.data.get("video_key") or "").strip()
    remove = str(request.data.get("remove_video", "")).strip().lower() in truthy
    if key:
        try:
            setattr(obj, file_field, resolve_video_key(key))
            setattr(obj, url_field, "")
            changed |= {file_field, url_field}
        except DjangoValidationError:
            pass  # bad key: the client validated it; skip rather than fail the save
    elif remove:
        if getattr(obj, file_field):
            setattr(obj, file_field, None)
        setattr(obj, url_field, "")
        changed |= {file_field, url_field}
    elif "video_url" in request.data:
        link = normalize_one(request.data.get("video_url") or "")
        setattr(obj, url_field, link)
        changed.add(url_field)
        if link and getattr(obj, file_field):
            setattr(obj, file_field, None)  # a link replaces an uploaded file
            changed.add(file_field)
    return changed


def _parse_id_list(raw):
    """Coerce a multipart/JSON value into a list[int]. None → None (field absent)."""
    if raw is None:
        return None
    if isinstance(raw, (list, tuple)):
        seq = raw
    elif isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            seq = parsed if isinstance(parsed, list) else [parsed]
        except (ValueError, TypeError):
            seq = s.split(",")
    else:
        seq = [raw]
    out = []
    for x in seq:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _annotated_lessons():
    # select_related classwork/midterm_exam: the summary serializer reads both for every
    # row (classwork_ready, midterm badge) — without this the timeline is N+1.
    return (
        JournalLesson.objects.select_related("classwork", "roadmap", "midterm_exam")
        .prefetch_related("roadmap__sections")
        .annotate(
            _assess_count=Count("assessments", distinct=True),
            _attach_count=Count("extra_attachments", distinct=True),
        )
        .order_by("lesson_number")
    )


def _journals_qs():
    return Journal.objects.prefetch_related(
        Prefetch("lessons", queryset=_annotated_lessons())
    )


def _allowed_assessment_ids(journal) -> set[int]:
    from assessments.models import AssessmentSet

    qs = AssessmentSet.objects.filter(is_active=True)
    if journal.domain_subject:
        qs = qs.filter(subject=journal.domain_subject)
    if journal.level:
        qs = qs.filter(level=journal.level)
    return set(qs.values_list("id", flat=True))


def _get_journal(journal_pk):
    return get_object_or_404(_journals_qs(), pk=journal_pk)


def _lesson_detail_response(lesson, request):
    lesson = (
        JournalLesson.objects.prefetch_related(
            "assessments__assessment_set", "extra_attachments"
        )
        .get(pk=lesson.pk)
    )
    return JournalLessonDetailSerializer(lesson, context={"request": request}).data


# --------------------------------------------------------------------------- media

class JournalVideoUploadUrlView(APIView):
    """POST {filename} -> presigned R2 PUT URL for a lesson video (admins only)."""

    permission_classes = JOURNAL_PERMS

    def post(self, request):
        try:
            info = presign_video_put(request.data.get("filename") or "")
        except DjangoValidationError as e:
            return Response({"detail": "; ".join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(info)


# --------------------------------------------------------------------------- journals

class JournalListCreateView(APIView):
    permission_classes = JOURNAL_PERMS

    def get(self, request):
        qs = _journals_qs()
        subject = (request.query_params.get("subject") or "").upper()
        st = (request.query_params.get("status") or "").upper()
        if subject:
            qs = qs.filter(subject=subject)
        if st:
            qs = qs.filter(status=st)
        data = JournalListSerializer(qs, many=True).data
        return Response({"results": data, "count": len(data)})

    def post(self, request):
        subject = request.data.get("subject")
        level = request.data.get("level")
        title = (request.data.get("title") or "").strip()
        try:
            journal, created = services.create_journal(
                subject=subject, level=level, actor=request.user, title=title
            )
        except structure.InvalidCourse as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        journal = _get_journal(journal.pk)
        body = JournalDetailSerializer(journal, context={"request": request}).data
        return Response(
            body, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )


class JournalDetailView(APIView):
    permission_classes = JOURNAL_PERMS

    def get(self, request, pk):
        journal = _get_journal(pk)
        return Response(JournalDetailSerializer(journal, context={"request": request}).data)

    def patch(self, request, pk):
        journal = _get_journal(pk)
        if "title" in request.data:
            journal.title = (request.data.get("title") or "").strip()
        journal.updated_by = request.user
        journal.save(update_fields=["title", "updated_by", "updated_at"])
        services.log_event(journal, request.user, "updated", {"fields": ["title"]})
        journal = _get_journal(pk)
        return Response(JournalDetailSerializer(journal, context={"request": request}).data)


class JournalPublishView(APIView):
    permission_classes = JOURNAL_PERMS

    def post(self, request, pk):
        journal = _get_journal(pk)
        result = services.publish_journal(journal, request.user)
        if not result["ok"]:
            return Response(
                {
                    "detail": "Cannot publish: some homework lessons are incomplete.",
                    "blocking_lessons": result["blocking_lessons"],
                },
                status=status.HTTP_409_CONFLICT,
            )
        journal = _get_journal(pk)
        return Response(JournalDetailSerializer(journal, context={"request": request}).data)


class JournalArchiveView(APIView):
    permission_classes = JOURNAL_PERMS

    def post(self, request, pk):
        journal = _get_journal(pk)
        services.set_journal_status(journal, Journal.STATUS_ARCHIVED, request.user)
        journal = _get_journal(pk)
        return Response(JournalDetailSerializer(journal, context={"request": request}).data)


class JournalUnarchiveView(APIView):
    permission_classes = JOURNAL_PERMS

    def post(self, request, pk):
        journal = _get_journal(pk)
        services.set_journal_status(journal, Journal.STATUS_DRAFT, request.user)
        journal = _get_journal(pk)
        return Response(JournalDetailSerializer(journal, context={"request": request}).data)


class JournalDuplicateView(APIView):
    permission_classes = JOURNAL_PERMS

    def post(self, request, pk):
        source = get_object_or_404(Journal, pk=pk)
        target_subject = request.data.get("target_subject") or request.data.get("subject")
        target_level = request.data.get("target_level") or request.data.get("level")
        try:
            target, report = services.duplicate_journal(
                source,
                target_subject=target_subject,
                target_level=target_level,
                actor=request.user,
            )
        except structure.InvalidCourse as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        target = _get_journal(target.pk)
        body = JournalDetailSerializer(target, context={"request": request}).data
        body["duplicate_report"] = report
        return Response(body, status=status.HTTP_201_CREATED)


class JournalExportView(APIView):
    permission_classes = JOURNAL_PERMS

    def get(self, request, pk):
        journal = get_object_or_404(
            Journal.objects.prefetch_related(
                "lessons__assessments", "lessons__classwork__assessments"
            ),
            pk=pk,
        )
        lessons = []
        for l in journal.lessons.all():
            row = {
                "lesson_number": l.lesson_number,
                "lesson_type": l.lesson_type,
                "title": l.title,
                "instructions": l.instructions,
                "external_url": l.external_url,
                "external_urls": list(l.external_urls or []),
                "video_url": l.video_url,
                "allow_file_upload": l.allow_file_upload,
                "practice_scope": l.practice_scope,
                "practice_test_ids": l.practice_test_ids or [],
                "practice_test_pack_ids": l.practice_test_pack_ids or [],
                "vocabulary_set_ids": l.vocabulary_set_ids or [],
                "category": l.category,
                "max_score": str(l.max_score) if l.max_score is not None else None,
                "assessment_set_ids": list(
                    l.assessments.values_list("assessment_set_id", flat=True)
                ),
                "midterm_exam_id": l.midterm_exam_id,
                "midterm_access_days_before": l.midterm_access_days_before,
            }
            cw = getattr(l, "classwork", None)
            if cw is not None:
                row["classwork"] = {
                    "homework_review_minutes": cw.homework_review_minutes,
                    "new_topic_minutes": cw.new_topic_minutes,
                    "break_minutes": cw.break_minutes,
                    "exercises_minutes": cw.exercises_minutes,
                    "revision_minutes": cw.revision_minutes,
                    "new_topic_title": cw.new_topic_title,
                    "new_topic_instructions": cw.new_topic_instructions,
                    "new_topic_external_url": cw.new_topic_external_url,
                    "new_topic_external_urls": list(cw.new_topic_external_urls or []),
                    "new_topic_video_url": cw.new_topic_video_url,
                    "new_topic_practice_test_ids": cw.new_topic_practice_test_ids or [],
                    "new_topic_practice_test_pack_ids": cw.new_topic_practice_test_pack_ids or [],
                    "new_topic_vocabulary_set_ids": cw.new_topic_vocabulary_set_ids or [],
                    "exercise_practice_test_ids": cw.exercise_practice_test_ids or [],
                    "exercise_practice_test_pack_ids": cw.exercise_practice_test_pack_ids or [],
                    "exercise_vocabulary_set_ids": cw.exercise_vocabulary_set_ids or [],
                    "revision_notes": cw.revision_notes,
                    "new_topic_assessment_set_ids": [
                        a.assessment_set_id
                        for a in cw.assessments.all()
                        if a.block == JournalClasswork.BLOCK_NEW_TOPIC
                    ],
                    "exercise_assessment_set_ids": [
                        a.assessment_set_id
                        for a in cw.assessments.all()
                        if a.block == JournalClasswork.BLOCK_EXERCISES
                    ],
                }
            lessons.append(row)
        return Response(
            {
                "format": "mastersat.journal",
                "version": 1,
                "subject": journal.subject,
                "level": journal.level,
                "title": journal.title,
                "lessons": lessons,
            }
        )


class JournalImportView(APIView):
    permission_classes = JOURNAL_PERMS
    parser_classes = _WRITE_PARSERS

    def post(self, request):
        payload = request.data.get("journal") if "journal" in request.data else request.data
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (ValueError, TypeError):
                return Response({"detail": "Invalid journal JSON."}, status=400)
        subject = (payload.get("subject") or "").upper()
        level = (payload.get("level") or "").lower()
        if not structure.is_valid_course(subject, level):
            return Response({"detail": "Invalid subject/level in import."}, status=400)

        journal, _created = services.create_journal(
            subject=subject, level=level, actor=request.user, title=payload.get("title") or ""
        )
        if journal.lessons.exists():
            return Response(
                {
                    "detail": (
                        f"{journal.display_title} already has sessions — clear it before "
                        f"importing into it."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        allowed = _allowed_assessment_ids(journal)
        applied = 0
        for row in sorted(
            payload.get("lessons", []), key=lambda r: r.get("lesson_number") or 0
        ):
            is_midterm = row.get("lesson_type") == JournalLesson.TYPE_MIDTERM
            midterm_exam = None
            if is_midterm and row.get("midterm_exam_id"):
                from midterms.models import Midterm

                midterm_exam = Midterm.objects.filter(pk=row["midterm_exam_id"]).first()
            lesson = services.add_session(
                journal,
                actor=request.user,
                lesson_type=(
                    JournalLesson.TYPE_MIDTERM if is_midterm else JournalLesson.TYPE_HOMEWORK
                ),
                midterm_exam=midterm_exam,
            )
            if is_midterm:
                lesson.midterm_access_days_before = int(
                    row.get("midterm_access_days_before") or 2
                )
                lesson.save(update_fields=["midterm_access_days_before"])
                applied += 1
                continue

            lesson.title = row.get("title") or ""
            lesson.instructions = row.get("instructions") or ""
            lesson.external_urls = _links_lenient(
                row.get("external_urls"), row.get("external_url")
            )
            lesson.external_url = first_url(lesson.external_urls)
            lesson.video_url = _video_lenient(row.get("video_url"))
            lesson.allow_file_upload = bool(row.get("allow_file_upload"))
            lesson.practice_scope = row.get("practice_scope") or JournalLesson.PRACTICE_SCOPE_BOTH
            lesson.practice_test_ids = row.get("practice_test_ids") or None
            lesson.practice_test_pack_ids = row.get("practice_test_pack_ids") or None
            lesson.vocabulary_set_ids = row.get("vocabulary_set_ids") or None
            lesson.category = row.get("category") or JournalLesson.CATEGORY_HOMEWORK
            lesson.status = JournalLesson.STATUS_DRAFT
            lesson.save()
            for sid in row.get("assessment_set_ids", []):
                if sid in allowed:
                    try:
                        JournalLessonAssessment.objects.create(
                            lesson=lesson, assessment_set_id=sid, added_by=request.user
                        )
                    except IntegrityError:
                        pass

            cw_row = row.get("classwork") or {}
            if cw_row:
                cw = services.ensure_classwork(lesson)
                for f in (
                    "homework_review_minutes",
                    "new_topic_minutes",
                    "break_minutes",
                    "exercises_minutes",
                    "revision_minutes",
                ):
                    if cw_row.get(f) is not None:
                        setattr(cw, f, int(cw_row[f]))
                cw.new_topic_title = cw_row.get("new_topic_title") or ""
                cw.new_topic_instructions = cw_row.get("new_topic_instructions") or ""
                cw.new_topic_external_urls = _links_lenient(
                    cw_row.get("new_topic_external_urls"),
                    cw_row.get("new_topic_external_url"),
                )
                cw.new_topic_external_url = first_url(cw.new_topic_external_urls)
                cw.new_topic_video_url = _video_lenient(cw_row.get("new_topic_video_url"))
                cw.new_topic_practice_test_ids = cw_row.get("new_topic_practice_test_ids") or None
                cw.new_topic_practice_test_pack_ids = (
                    cw_row.get("new_topic_practice_test_pack_ids") or None
                )
                cw.new_topic_vocabulary_set_ids = cw_row.get("new_topic_vocabulary_set_ids") or None
                cw.exercise_practice_test_ids = cw_row.get("exercise_practice_test_ids") or None
                cw.exercise_practice_test_pack_ids = (
                    cw_row.get("exercise_practice_test_pack_ids") or None
                )
                cw.exercise_vocabulary_set_ids = cw_row.get("exercise_vocabulary_set_ids") or None
                cw.revision_notes = cw_row.get("revision_notes") or ""
                cw.save()
                for key, block in (
                    ("new_topic_assessment_set_ids", JournalClasswork.BLOCK_NEW_TOPIC),
                    ("exercise_assessment_set_ids", JournalClasswork.BLOCK_EXERCISES),
                ):
                    for sid in cw_row.get(key, []):
                        if sid in allowed:
                            try:
                                JournalClassworkAssessment.objects.create(
                                    classwork=cw,
                                    assessment_set_id=sid,
                                    block=block,
                                    added_by=request.user,
                                )
                            except IntegrityError:
                                pass
            applied += 1
        services.log_event(journal, request.user, "imported", {"sessions_applied": applied})
        journal = _get_journal(journal.pk)
        return Response(
            JournalDetailSerializer(journal, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class JournalSessionCreateView(APIView):
    """POST /api/journals/{id}/sessions/ — append a new session ("New session").

    Body: {"type": "HOMEWORK"|"MIDTERM", "midterm_exam_id": <id, midterm only>}
    Nothing is pre-provisioned; the admin decides how many sessions and midterms exist.
    """

    permission_classes = JOURNAL_PERMS

    def post(self, request, pk):
        journal = get_object_or_404(Journal, pk=pk)
        if journal.status == Journal.STATUS_ARCHIVED:
            return Response(
                {"detail": "Journal is archived (read-only)."},
                status=status.HTTP_409_CONFLICT,
            )
        lesson_type = (request.data.get("type") or JournalLesson.TYPE_HOMEWORK).upper()
        midterm_exam = None
        if lesson_type == JournalLesson.TYPE_MIDTERM:
            exam_id = request.data.get("midterm_exam_id")
            if exam_id:
                from midterms.models import Midterm

                midterm_exam = Midterm.objects.filter(pk=exam_id).first()
                if midterm_exam is None:
                    return Response(
                        {"detail": "Midterm not found."}, status=status.HTTP_400_BAD_REQUEST
                    )
        try:
            lesson = services.add_session(
                journal, actor=request.user, lesson_type=lesson_type, midterm_exam=midterm_exam
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_lesson_detail_response(lesson, request), status=status.HTTP_201_CREATED)


class JournalMidtermOptionsView(APIView):
    """GET /api/journals/midterm-options/?subject=&level= — midterms available for a level.

    Filters ``midterms.Midterm`` (NOT the legacy exams.MockExam, whose midterm_level misses
    every natively-authored midterm) by the journal's platform subject and exact level.
    """

    permission_classes = JOURNAL_PERMS

    def get(self, request):
        subject = (request.query_params.get("subject") or "").upper()
        level = (request.query_params.get("level") or "").lower()
        if not structure.is_valid_course(subject, level):
            return Response({"detail": "Invalid subject/level."}, status=400)

        from midterms.models import Midterm

        platform_subject = Journal._PLATFORM_SUBJECT.get(subject)
        qs = Midterm.objects.filter(is_published=True)
        if platform_subject:
            qs = qs.filter(subject=platform_subject)
        qs = qs.filter(level=level)

        midterms = []
        for m in qs.order_by("-created_at"):
            try:
                question_count = m.display_question_count()
            except Exception:  # noqa: BLE001 — display helper is best-effort
                question_count = None
            midterms.append(
                {
                    "id": m.id,
                    "title": m.title or "",
                    "subject": m.subject,
                    "level": m.level or "",
                    "scoring_scale": getattr(m, "scoring_scale", "") or "",
                    "duration_minutes": getattr(m, "duration_minutes", None),
                    "question_count": question_count,
                }
            )
        return Response({"subject": subject, "level": level, "midterms": midterms})


class JournalContentOptionsView(APIView):
    """Level-scoped pickable content for the lesson editor — mirrors
    ``classes.views.assignment_options`` but scoped by (subject, level), not a classroom."""

    permission_classes = JOURNAL_PERMS

    def get(self, request):
        subject = (request.query_params.get("subject") or "").upper()
        level = (request.query_params.get("level") or "").lower()
        if not structure.is_valid_course(subject, level):
            return Response({"detail": "Invalid subject/level."}, status=400)

        platform_subject = Journal._PLATFORM_SUBJECT.get(subject)
        domain_subject = Journal._DOMAIN_SUBJECT.get(subject)

        # Already-attached ids for THIS lesson (Available / Already-attached split).
        attached_set_ids: set[int] = set()
        attached_pt_ids: set[int] = set()
        attached_pack_ids: set[int] = set()
        attached_vocab_ids: set[int] = set()
        lesson_id = request.query_params.get("lesson")
        if lesson_id:
            lesson = JournalLesson.objects.filter(pk=lesson_id).first()
            if lesson is not None:
                attached_set_ids = set(
                    lesson.assessments.values_list("assessment_set_id", flat=True)
                )
                attached_pt_ids = set(int(x) for x in (lesson.practice_test_ids or []))
                attached_pack_ids = set(int(x) for x in (lesson.practice_test_pack_ids or []))
                attached_vocab_ids = set(int(x) for x in (lesson.vocabulary_set_ids or []))

        # Past papers (subject only — PracticeTest has no level).
        from exams.views import PracticeTestViewSet

        pvs = PracticeTestViewSet()
        pvs.request = request
        pvs.format_kwarg = None
        pt_qs = pvs.get_queryset()
        if platform_subject:
            pt_qs = pt_qs.filter(subject=platform_subject)
        practice_tests = [
            {
                "id": pt.id,
                "title": (pt.title or "").strip(),
                "subject": pt.subject,
                "label": pt.label or "",
                "form_type": pt.form_type,
                "practice_date": pt.practice_date.isoformat() if pt.practice_date else None,
                "created_at": pt.created_at.isoformat() if pt.created_at else None,
                "mock_exam": None,
                "collection_name": pt.collection_name or "",
                "is_published": pt.is_published,
                "already_assigned": pt.id in attached_pt_ids,
            }
            for pt in pt_qs
        ]

        # Assessment sets (subject + level scoped).
        from assessments.models import AssessmentSet

        aset_qs = AssessmentSet.objects.filter(is_active=True)
        if domain_subject:
            aset_qs = aset_qs.filter(subject=domain_subject)
        if level:
            aset_qs = aset_qs.filter(level=level)
        assessment_sets = [
            {
                "id": a.id,
                "title": a.title,
                "subject": a.subject,
                "source": a.source or "",
                "level": a.level or "",
                "category": a.category or "",
                "description": a.description or "",
                "question_count": a.questions.filter(is_active=True).count(),
                "already_assigned": a.id in attached_set_ids,
            }
            for a in aset_qs.order_by("-created_at")
        ]

        # Custom practice-test packs.
        from exams.models import PracticeTestPack

        practice_test_packs = [
            {
                "id": p.id,
                "title": p.title or "",
                "description": p.description or "",
                "section_count": p.sections.count(),
                "already_assigned": p.id in attached_pack_ids,
            }
            for p in PracticeTestPack.objects.filter(is_published=True).order_by("-created_at")
        ]

        # Vocabulary sections + their bank sets. Deliberately NOT subject/level-filtered:
        # vocabulary is general SAT prep, so any journal may assign any published section
        # (mirrors classes.views.assignment_options).
        from vocabulary.models import VocabSection, VocabSetItem

        vocab_word_counts = dict(
            VocabSetItem.objects.filter(vocab_set__section__is_published=True)
            .values_list("vocab_set")
            .order_by()
            .annotate(n=Count("id"))
            .values_list("vocab_set", "n")
        )
        vocabulary_sections = []
        for section in VocabSection.objects.filter(is_published=True).prefetch_related("sets"):
            vocabulary_sections.append(
                {
                    "id": section.id,
                    "title": section.title,
                    "sets": [
                        {
                            "id": vset.id,
                            "title": vset.title,
                            "word_count": vocab_word_counts.get(vset.id, 0),
                            "already_assigned": vset.id in attached_vocab_ids,
                        }
                        for vset in section.sets.filter(owner__isnull=True)
                    ],
                }
            )

        return Response(
            {
                "subject": subject,
                "level": level,
                "classroom_subject": subject,  # frontend-picker compat keys
                "classroom_level": level,
                "practice_tests": practice_tests,
                "assessment_sets": assessment_sets,
                "practice_test_packs": practice_test_packs,
                "vocabulary_sections": vocabulary_sections,
            }
        )


# --------------------------------------------------------------------------- lessons

class LessonListView(APIView):
    permission_classes = JOURNAL_PERMS

    def get(self, request, journal_pk):
        journal = get_object_or_404(Journal, pk=journal_pk)
        qs = _annotated_lessons().filter(journal=journal)
        p = request.query_params
        if p.get("type"):
            qs = qs.filter(lesson_type=p["type"].upper())
        if p.get("status"):
            qs = qs.filter(status=p["status"].upper())
        lessons = list(qs)

        def keep(l):
            if p.get("has_files") in _TRUTHY and not (
                l.attachment_file or l._extra_attachment_count()
            ):
                return False
            if p.get("has_assessment") in _TRUTHY and l._assessment_count() == 0:
                return False
            if p.get("has_pastpaper") in _TRUTHY and not (
                l.practice_test_ids or l.practice_test_pack_ids
            ):
                return False
            if p.get("missing") in _TRUTHY and (l.is_midterm or l.is_ready):
                return False
            term = (p.get("search") or p.get("q") or "").strip().lower()
            if term:
                hay = f"{l.lesson_number} {l.title} {l.instructions}".lower()
                if term not in hay:
                    return False
            return True

        lessons = [l for l in lessons if keep(l)]
        data = JournalLessonSummarySerializer(lessons, many=True).data
        return Response({"results": data, "count": len(data)})


class LessonDetailView(APIView):
    permission_classes = JOURNAL_PERMS
    parser_classes = _WRITE_PARSERS

    _CONTENT_KEYS = {
        "instructions",
        "external_url",
        "external_urls",
        "video_url",
        "practice_scope",
        "assessment_set_ids",
        "practice_test_ids",
        "practice_test_pack_ids",
        "allow_file_upload",
        "max_score",
        "title",
    }

    def get(self, request, journal_pk, pk):
        lesson = get_object_or_404(
            JournalLesson.objects.prefetch_related(
                "assessments__assessment_set", "extra_attachments"
            ),
            pk=pk,
            journal_id=journal_pk,
        )
        return Response(
            JournalLessonDetailSerializer(lesson, context={"request": request}).data
        )

    def patch(self, request, journal_pk, pk):
        lesson = get_object_or_404(JournalLesson, pk=pk, journal_id=journal_pk)
        journal = lesson.journal
        if journal.status == Journal.STATUS_ARCHIVED:
            return Response(
                {"detail": "Journal is archived (read-only)."},
                status=status.HTTP_409_CONFLICT,
            )
        if lesson.is_midterm:
            touches = self._CONTENT_KEYS & set(request.data.keys())
            if touches or request.FILES.getlist("attachment_file"):
                return Response(
                    {"detail": "Midterm sessions have no homework fields."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Only the midterm config is writable on a midterm session.
            changed: list[str] = []
            if "midterm_exam_id" in request.data:
                exam_id = request.data.get("midterm_exam_id")
                if exam_id in (None, "", "null"):
                    lesson.midterm_exam = None
                else:
                    from midterms.models import Midterm

                    exam = Midterm.objects.filter(pk=exam_id).first()
                    if exam is None:
                        return Response(
                            {"detail": "Midterm not found."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    lesson.midterm_exam = exam
                changed.append("midterm_exam")
            if "midterm_access_days_before" in request.data:
                try:
                    lesson.midterm_access_days_before = max(
                        0, int(request.data["midterm_access_days_before"])
                    )
                except (TypeError, ValueError):
                    return Response(
                        {"detail": "midterm_access_days_before must be a whole number."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                changed.append("midterm_access_days_before")
            if changed:
                lesson.save(update_fields=changed + ["updated_at"])
                services.log_event(
                    journal,
                    request.user,
                    "midterm_updated",
                    {"lesson_number": lesson.lesson_number},
                    lesson=lesson,
                )
            return Response(_lesson_detail_response(lesson, request))

        from .serializers import JournalLessonWriteSerializer

        ser = JournalLessonWriteSerializer(lesson, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()

        # Multi-link: external_urls (list) is the source of truth, external_url mirrors the
        # first. Handled here, not in the serializer, so multipart JSON-string and JSON-body
        # arrays both work and the two fields can never drift.
        try:
            resolved = resolve_links(request.data)
        except DjangoValidationError as e:
            return Response(
                {"detail": "; ".join(e.messages), "code": "invalid_link"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if resolved is not None:
            lesson.external_urls, lesson.external_url = resolved
            lesson.save(update_fields=["external_urls", "external_url", "updated_at"])

        try:
            vchanged = apply_journal_video(
                lesson, request, url_field="video_url", file_field="video_file"
            )
        except DjangoValidationError as e:
            return Response(
                {"detail": "; ".join(e.messages), "code": "invalid_video"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if vchanged:
            lesson.save(update_fields=list(vchanged) + ["updated_at"])

        if "practice_test_ids" in request.data:
            lesson.practice_test_ids = _parse_id_list(request.data.get("practice_test_ids")) or None
        if "practice_test_pack_ids" in request.data:
            lesson.practice_test_pack_ids = (
                _parse_id_list(request.data.get("practice_test_pack_ids")) or None
            )
        if "vocabulary_set_ids" in request.data:
            lesson.vocabulary_set_ids = (
                _parse_id_list(request.data.get("vocabulary_set_ids")) or None
            )

        files = request.FILES.getlist("attachment_file")
        replace = request.query_params.get("replace_attachments") in _TRUTHY
        if replace:
            for extra in lesson.extra_attachments.all():
                extra.file.delete(save=False)
                extra.delete()
            if lesson.attachment_file:
                lesson.attachment_file.delete(save=False)
            lesson.attachment_file = None
        for f in files:
            if not lesson.attachment_file:
                lesson.attachment_file = f
            else:
                JournalLessonAttachment.objects.create(lesson=lesson, file=f)
        lesson.save()

        if "assessment_set_ids" in request.data:
            allowed = _allowed_assessment_ids(journal)
            target = set(_parse_id_list(request.data.get("assessment_set_ids")) or []) & allowed
            current = set(lesson.assessments.values_list("assessment_set_id", flat=True))
            for sid in target - current:
                try:
                    JournalLessonAssessment.objects.create(
                        lesson=lesson, assessment_set_id=sid, added_by=request.user
                    )
                except IntegrityError:
                    pass
            removed = current - target
            if removed:
                lesson.assessments.filter(assessment_set_id__in=removed).delete()

        journal.updated_by = request.user
        journal.save(update_fields=["updated_by", "updated_at"])
        services.log_event(
            journal,
            request.user,
            "lesson_updated",
            {"lesson_number": lesson.lesson_number},
            lesson=lesson,
        )
        return Response(_lesson_detail_response(lesson, request))

    def delete(self, request, journal_pk, pk):
        """Remove a session; remaining sessions are renumbered to stay contiguous."""
        lesson = get_object_or_404(JournalLesson, pk=pk, journal_id=journal_pk)
        journal = lesson.journal
        if journal.status == Journal.STATUS_ARCHIVED:
            return Response(
                {"detail": "Journal is archived (read-only)."},
                status=status.HTTP_409_CONFLICT,
            )
        services.delete_session(journal, lesson, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClassworkDetailView(APIView):
    """GET/PATCH the in-class plan for a session (the five timetable blocks)."""

    permission_classes = JOURNAL_PERMS
    parser_classes = _WRITE_PARSERS

    _BLOCK_KEYS = {
        "new_topic_assessment_set_ids": JournalClasswork.BLOCK_NEW_TOPIC,
        "exercise_assessment_set_ids": JournalClasswork.BLOCK_EXERCISES,
    }
    _ID_LIST_FIELDS = (
        "new_topic_practice_test_ids",
        "new_topic_practice_test_pack_ids",
        "new_topic_vocabulary_set_ids",
        "exercise_practice_test_ids",
        "exercise_practice_test_pack_ids",
        "exercise_vocabulary_set_ids",
    )

    def _get_lesson(self, journal_pk, pk):
        return get_object_or_404(JournalLesson, pk=pk, journal_id=journal_pk)

    def get(self, request, journal_pk, pk):
        lesson = self._get_lesson(journal_pk, pk)
        if lesson.is_midterm:
            return Response(
                {"detail": "Midterm sessions have no classwork."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cw = services.ensure_classwork(lesson)
        return Response(JournalClassworkSerializer(cw, context={"request": request}).data)

    def patch(self, request, journal_pk, pk):
        lesson = self._get_lesson(journal_pk, pk)
        journal = lesson.journal
        if journal.status == Journal.STATUS_ARCHIVED:
            return Response(
                {"detail": "Journal is archived (read-only)."},
                status=status.HTTP_409_CONFLICT,
            )
        if lesson.is_midterm:
            return Response(
                {"detail": "Midterm sessions have no classwork."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cw = services.ensure_classwork(lesson)

        ser = JournalClassworkWriteSerializer(cw, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()

        # Multi-link on the new-topic block (mirror kept in sync — see LessonDetailView).
        try:
            resolved = resolve_links(
                request.data,
                list_key="new_topic_external_urls",
                single_key="new_topic_external_url",
            )
        except DjangoValidationError as e:
            return Response(
                {"detail": "; ".join(e.messages), "code": "invalid_link"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if resolved is not None:
            cw.new_topic_external_urls, cw.new_topic_external_url = resolved

        try:
            apply_journal_video(
                cw, request, url_field="new_topic_video_url", file_field="new_topic_video_file"
            )
        except DjangoValidationError as e:
            return Response(
                {"detail": "; ".join(e.messages), "code": "invalid_video"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Both fields are persisted by the cw.save() later in this handler.

        for field in self._ID_LIST_FIELDS:
            if field in request.data:
                setattr(cw, field, _parse_id_list(request.data.get(field)) or None)

        files = request.FILES.getlist("new_topic_attachment_file")
        replace = request.query_params.get("replace_attachments") in _TRUTHY
        if replace:
            for extra in cw.extra_attachments.all():
                extra.file.delete(save=False)
                extra.delete()
            if cw.new_topic_attachment_file:
                cw.new_topic_attachment_file.delete(save=False)
            cw.new_topic_attachment_file = None
        for f in files:
            if not cw.new_topic_attachment_file:
                cw.new_topic_attachment_file = f
            else:
                JournalClassworkAttachment.objects.create(
                    classwork=cw, file=f, block=JournalClasswork.BLOCK_NEW_TOPIC
                )
        cw.save()

        allowed = _allowed_assessment_ids(journal)
        for key, block in self._BLOCK_KEYS.items():
            if key not in request.data:
                continue
            target = set(_parse_id_list(request.data.get(key)) or []) & allowed
            current = set(
                cw.assessments.filter(block=block).values_list("assessment_set_id", flat=True)
            )
            for sid in target - current:
                try:
                    JournalClassworkAssessment.objects.create(
                        classwork=cw,
                        assessment_set_id=sid,
                        block=block,
                        added_by=request.user,
                    )
                except IntegrityError:
                    pass
            removed = current - target
            if removed:
                cw.assessments.filter(block=block, assessment_set_id__in=removed).delete()

        journal.updated_by = request.user
        journal.save(update_fields=["updated_by", "updated_at"])
        services.log_event(
            journal,
            request.user,
            "classwork_updated",
            {"lesson_number": lesson.lesson_number},
            lesson=lesson,
        )
        cw.refresh_from_db()
        return Response(JournalClassworkSerializer(cw, context={"request": request}).data)


class LessonPublishView(APIView):
    permission_classes = JOURNAL_PERMS

    def post(self, request, journal_pk, pk):
        lesson = get_object_or_404(JournalLesson, pk=pk, journal_id=journal_pk)
        if lesson.is_midterm:
            return Response(
                {"detail": "Midterm lessons are not published."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reasons = lesson.validation_reasons()
        if reasons:
            return Response(
                {"detail": "Lesson is incomplete.", "reasons": reasons},
                status=status.HTTP_409_CONFLICT,
            )
        lesson.status = JournalLesson.STATUS_PUBLISHED
        lesson.published_at = timezone.now()
        lesson.save(update_fields=["status", "published_at", "updated_at"])
        services.log_event(
            lesson.journal, request.user, "lesson_published",
            {"lesson_number": lesson.lesson_number}, lesson=lesson,
        )
        return Response(_lesson_detail_response(lesson, request))


class LessonResetView(APIView):
    permission_classes = JOURNAL_PERMS

    def post(self, request, journal_pk, pk):
        lesson = get_object_or_404(JournalLesson, pk=pk, journal_id=journal_pk)
        lesson.status = JournalLesson.STATUS_DRAFT
        lesson.published_at = None
        lesson.save(update_fields=["status", "published_at", "updated_at"])
        services.log_event(
            lesson.journal, request.user, "lesson_reset",
            {"lesson_number": lesson.lesson_number}, lesson=lesson,
        )
        return Response(_lesson_detail_response(lesson, request))


class LessonBulkView(APIView):
    permission_classes = JOURNAL_PERMS
    parser_classes = _WRITE_PARSERS

    def post(self, request, journal_pk):
        journal = get_object_or_404(Journal, pk=journal_pk)
        if journal.status == Journal.STATUS_ARCHIVED:
            # Mirror the per-lesson PATCH lock: an archived journal is read-only, so
            # bulk clear/draft/publish must not mutate its lessons.
            return Response(
                {"detail": "Journal is archived (read-only)."},
                status=status.HTTP_409_CONFLICT,
            )
        action = (request.data.get("action") or "").strip()
        ids = _parse_id_list(request.data.get("ids")) or []
        payload = request.data.get("payload") or {}
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (ValueError, TypeError):
                payload = {}

        seen: set[int] = set()
        ordered = [i for i in ids if not (i in seen or seen.add(i))]
        lessons = {l.id: l for l in journal.lessons.filter(id__in=ordered)}

        results, affected, skipped = [], 0, 0
        for lid in ordered:
            lesson = lessons.get(lid)
            if lesson is None:
                results.append({"id": lid, "ok": False, "reason": "not found"})
                skipped += 1
                continue
            try:
                with transaction.atomic():
                    ok, reason = self._apply(action, lesson, payload, journal, request.user)
            except Exception as e:  # noqa: BLE001 — per-row isolation
                ok, reason = False, str(e)
            results.append({"id": lid, "ok": ok, "reason": reason})
            affected += 1 if ok else 0
            skipped += 0 if ok else 1

        services.log_event(
            journal, request.user, f"bulk_{action or 'noop'}",
            {"affected": affected, "skipped": skipped},
        )
        return Response({"results": results, "affected": affected, "skipped": skipped})

    def _apply(self, action, lesson, payload, journal, user):
        if action in ("publish", "draft", "clear", "replace_assessment", "replace_pastpaper", "copy_from"):
            if lesson.is_midterm:
                return False, "midterm lesson skipped"

        if action == "publish":
            reasons = lesson.validation_reasons()
            if reasons:
                return False, "; ".join(reasons)
            lesson.status = JournalLesson.STATUS_PUBLISHED
            lesson.published_at = timezone.now()
            lesson.save(update_fields=["status", "published_at", "updated_at"])
            return True, "published"

        if action == "draft":
            lesson.status = JournalLesson.STATUS_DRAFT
            lesson.published_at = None
            lesson.save(update_fields=["status", "published_at", "updated_at"])
            return True, "drafted"

        if action == "clear":
            lesson.title = ""
            lesson.instructions = ""
            lesson.external_url = ""
            lesson.external_urls = []
            lesson.video_url = ""
            lesson.allow_file_upload = False
            lesson.practice_test_ids = None
            lesson.practice_test_pack_ids = None
            lesson.vocabulary_set_ids = None
            lesson.status = JournalLesson.STATUS_DRAFT
            lesson.published_at = None
            if lesson.attachment_file:
                lesson.attachment_file.delete(save=False)
                lesson.attachment_file = None
            lesson.save()
            lesson.assessments.all().delete()
            for extra in lesson.extra_attachments.all():
                extra.file.delete(save=False)
                extra.delete()
            return True, "cleared"

        if action == "replace_assessment":
            allowed = _allowed_assessment_ids(journal)
            target = set(_parse_id_list(payload.get("assessment_set_ids")) or []) & allowed
            lesson.assessments.all().delete()
            for sid in target:
                try:
                    JournalLessonAssessment.objects.create(
                        lesson=lesson, assessment_set_id=sid, added_by=user
                    )
                except IntegrityError:
                    pass
            return True, f"assessments={len(target)}"

        if action == "replace_pastpaper":
            lesson.practice_test_ids = _parse_id_list(payload.get("practice_test_ids")) or None
            lesson.practice_test_pack_ids = (
                _parse_id_list(payload.get("practice_test_pack_ids")) or None
            )
            lesson.save(update_fields=["practice_test_ids", "practice_test_pack_ids", "updated_at"])
            return True, "pastpapers replaced"

        if action == "copy_from":
            src_id = payload.get("source_lesson_id")
            src = journal.lessons.filter(pk=src_id).first()
            if src is None or src.is_midterm:
                return False, "invalid source lesson"
            if src.id == lesson.id:
                return False, "source == target"
            lesson.title = src.title
            lesson.instructions = src.instructions
            lesson.external_urls = list(src.external_urls or [])
            lesson.external_url = src.external_url
            lesson.video_url = src.video_url
            lesson.allow_file_upload = src.allow_file_upload
            lesson.practice_scope = src.practice_scope
            lesson.practice_test_ids = src.practice_test_ids
            lesson.practice_test_pack_ids = src.practice_test_pack_ids
            lesson.vocabulary_set_ids = src.vocabulary_set_ids
            # due_after_days / deadline_time were dropped in 0002 — homework is due at
            # the start of the classroom's next lesson, derived at release time. Reading
            # them here raised AttributeError and failed every copied row.
            lesson.category = src.category
            lesson.max_score = src.max_score
            lesson.status = JournalLesson.STATUS_DRAFT
            lesson.published_at = None
            lesson.save()
            existing = set(lesson.assessments.values_list("assessment_set_id", flat=True))
            for link in src.assessments.all():
                if link.assessment_set_id not in existing:
                    JournalLessonAssessment.objects.create(
                        lesson=lesson, assessment_set_id=link.assessment_set_id, added_by=user
                    )
            return True, "copied"

        return False, f"unknown action '{action}'"


# --------------------------------------------------------------------------- roadmap


class RoadmapDetailView(APIView):
    """GET/PATCH the reading a student does before a session's homework.

    The PATCH is DECLARATIVE about sections: the client sends the whole ``sections`` list as
    it should end up, and this reconciles — sections with an ``id`` are updated, ones without
    are created, and any the list omits are deleted. One request for the whole block rather
    than a create/update/delete/reorder API each, because reordering a reading is moving four
    paragraphs at once and doing that as four requests leaves the page half-reordered if any
    of them fails.

    ``order`` is taken from the list POSITION, not from a field. A client that sends its own
    numbers can send two of the same, and the resulting tie is broken by primary key — which
    puts a paragraph the author moved to the top back at the bottom.

    Files ride a separate endpoint (:class:`RoadmapSectionMediaView`): an image belongs to a
    section that must already exist to attach it to, and mixing a multipart body into a
    declarative JSON list means encoding which file goes with which unsaved list index.
    """

    permission_classes = JOURNAL_PERMS
    parser_classes = [JSONParser]

    _SECTION_SCALARS = ("kind", "heading", "body", "caption", "video_url")

    def _get_lesson(self, journal_pk, pk):
        return get_object_or_404(JournalLesson, pk=pk, journal_id=journal_pk)

    def _guard(self, lesson):
        """The two refusals both endpoints share. Returns a Response, or None."""
        if lesson.journal.status == Journal.STATUS_ARCHIVED:
            return Response(
                {"detail": "Journal is archived (read-only)."},
                status=status.HTTP_409_CONFLICT,
            )
        if lesson.is_midterm:
            # A midterm is a sitting, not a topic. There is nothing to read beforehand, and
            # offering the tab would suggest otherwise.
            return Response(
                {"detail": "Midterm sessions have no roadmap."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return None

    def get(self, request, journal_pk, pk):
        lesson = self._get_lesson(journal_pk, pk)
        if lesson.is_midterm:
            return Response(
                {"detail": "Midterm sessions have no roadmap."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        roadmap = services.ensure_roadmap(lesson)
        return Response(JournalRoadmapSerializer(roadmap, context={"request": request}).data)

    @transaction.atomic
    def patch(self, request, journal_pk, pk):
        lesson = self._get_lesson(journal_pk, pk)
        denied = self._guard(lesson)
        if denied:
            return denied

        roadmap = services.ensure_roadmap(lesson)
        write = JournalRoadmapWriteSerializer(roadmap, data=request.data, partial=True)
        write.is_valid(raise_exception=True)
        write.save()

        sections = request.data.get("sections")
        if isinstance(sections, list):
            kept: list[int] = []
            for position, raw in enumerate(sections):
                if not isinstance(raw, dict):
                    continue
                fields = {
                    key: raw[key] for key in self._SECTION_SCALARS if key in raw
                }
                kind = fields.get("kind")
                if kind is not None and kind not in dict(JournalRoadmapSection.KIND_CHOICES):
                    return Response(
                        {"detail": f"Unknown section kind {kind!r}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                fields["order"] = position
                section_id = raw.get("id")
                if section_id:
                    updated = JournalRoadmapSection.objects.filter(
                        pk=section_id, roadmap=roadmap
                    ).update(**fields)
                    if updated:
                        kept.append(int(section_id))
                        continue
                    # An id that is not ours is treated as a new section rather than as an
                    # error: the client's list is what the author sees, and refusing the
                    # whole save over one stale id would lose everything else they wrote.
                created = JournalRoadmapSection.objects.create(roadmap=roadmap, **fields)
                kept.append(created.pk)
            # Whatever the list left out is gone. Deleting a section deletes its image with
            # the row; the file itself is left in the bucket, which is what every other
            # delete in this app does.
            roadmap.sections.exclude(pk__in=kept).delete()

        lesson.journal.updated_by = request.user
        lesson.journal.save(update_fields=["updated_by", "updated_at"])
        services.log_event(
            lesson.journal,
            request.user,
            "roadmap_updated",
            {"lesson_number": lesson.lesson_number},
            lesson=lesson,
        )
        roadmap.refresh_from_db()
        return Response(JournalRoadmapSerializer(roadmap, context={"request": request}).data)


class RoadmapSectionMediaView(APIView):
    """``POST`` a picture or a video onto one roadmap section; ``DELETE`` to clear it.

    Multipart, field name ``file``. Which column it lands in follows the section's own
    ``kind`` rather than a parameter — an IMAGE section has nowhere to put a video, and
    letting the caller choose would make the two disagree.
    """

    permission_classes = JOURNAL_PERMS
    parser_classes = _WRITE_PARSERS

    def _section(self, journal_pk, pk, section_id):
        lesson = get_object_or_404(JournalLesson, pk=pk, journal_id=journal_pk)
        roadmap = get_object_or_404(JournalRoadmap, lesson=lesson)
        return lesson, get_object_or_404(JournalRoadmapSection, pk=section_id, roadmap=roadmap)

    def post(self, request, journal_pk, pk, section_id):
        lesson, section = self._section(journal_pk, pk, section_id)
        if lesson.journal.status == Journal.STATUS_ARCHIVED:
            return Response(
                {"detail": "Journal is archived (read-only)."},
                status=status.HTTP_409_CONFLICT,
            )
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "No file was sent."}, status=status.HTTP_400_BAD_REQUEST)
        if section.kind == JournalRoadmapSection.KIND_IMAGE:
            section.image = upload
            section.save(update_fields=["image", "updated_at"])
        elif section.kind == JournalRoadmapSection.KIND_VIDEO:
            section.video_file = upload
            section.save(update_fields=["video_file", "updated_at"])
        else:
            return Response(
                {"detail": "A text section takes no file."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            JournalRoadmapSectionSerializer(section, context={"request": request}).data
        )

    def delete(self, request, journal_pk, pk, section_id):
        _, section = self._section(journal_pk, pk, section_id)
        if section.image:
            section.image = None
        if section.video_file:
            section.video_file = None
        section.save(update_fields=["image", "video_file", "updated_at"])
        return Response(
            JournalRoadmapSectionSerializer(section, context={"request": request}).data
        )
