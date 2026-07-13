"""Journal REST API (admin-only).

Explicit APIViews (matching the builder/admin idiom); urls.py registers bulk/collection
paths before ``<int:pk>`` catch-alls. All views are gated by ``CanManageJournals`` — global
staff only (teachers must never author journals).
"""

from __future__ import annotations

import json

from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from access.permissions import CanManageJournals
from users.permissions import IsAuthenticatedAndNotFrozen

from . import services, structure
from .models import (
    Journal,
    JournalLesson,
    JournalLessonAssessment,
    JournalLessonAttachment,
)
from .serializers import (
    JournalDetailSerializer,
    JournalLessonDetailSerializer,
    JournalLessonSummarySerializer,
    JournalListSerializer,
)

JOURNAL_PERMS = [IsAuthenticatedAndNotFrozen, CanManageJournals]
_WRITE_PARSERS = [MultiPartParser, FormParser, JSONParser]

_TRUTHY = {"1", "true", "True", "yes", "on"}


# --------------------------------------------------------------------------- helpers

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
    return JournalLesson.objects.annotate(
        _assess_count=Count("assessments", distinct=True),
        _attach_count=Count("extra_attachments", distinct=True),
    ).order_by("lesson_number")


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
            Journal.objects.prefetch_related("lessons__assessments"), pk=pk
        )
        lessons = []
        for l in journal.lessons.all():
            lessons.append(
                {
                    "lesson_number": l.lesson_number,
                    "lesson_type": l.lesson_type,
                    "title": l.title,
                    "instructions": l.instructions,
                    "external_url": l.external_url,
                    "allow_file_upload": l.allow_file_upload,
                    "practice_scope": l.practice_scope,
                    "practice_test_ids": l.practice_test_ids or [],
                    "practice_test_pack_ids": l.practice_test_pack_ids or [],
                    "due_after_days": l.due_after_days,
                    "deadline_time": l.deadline_time.isoformat() if l.deadline_time else None,
                    "category": l.category,
                    "max_score": str(l.max_score) if l.max_score is not None else None,
                    "assessment_set_ids": list(
                        l.assessments.values_list("assessment_set_id", flat=True)
                    ),
                }
            )
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
        allowed = _allowed_assessment_ids(journal)
        by_number = {l.lesson_number: l for l in journal.lessons.all()}
        applied = 0
        for row in payload.get("lessons", []):
            lesson = by_number.get(row.get("lesson_number"))
            if lesson is None or lesson.is_midterm or row.get("lesson_type") == JournalLesson.TYPE_MIDTERM:
                continue
            lesson.title = row.get("title") or ""
            lesson.instructions = row.get("instructions") or ""
            lesson.external_url = row.get("external_url") or ""
            lesson.allow_file_upload = bool(row.get("allow_file_upload"))
            lesson.practice_scope = row.get("practice_scope") or JournalLesson.PRACTICE_SCOPE_BOTH
            lesson.practice_test_ids = row.get("practice_test_ids") or None
            lesson.practice_test_pack_ids = row.get("practice_test_pack_ids") or None
            lesson.due_after_days = row.get("due_after_days")
            lesson.category = row.get("category") or JournalLesson.CATEGORY_HOMEWORK
            lesson.status = JournalLesson.STATUS_DRAFT
            lesson.save()
            lesson.assessments.all().delete()
            for sid in row.get("assessment_set_ids", []):
                if sid in allowed:
                    try:
                        JournalLessonAssessment.objects.create(
                            lesson=lesson, assessment_set_id=sid, added_by=request.user
                        )
                    except IntegrityError:
                        pass
            applied += 1
        services.log_event(journal, request.user, "imported", {"lessons_applied": applied})
        journal = _get_journal(journal.pk)
        return Response(
            JournalDetailSerializer(journal, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


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
        lesson_id = request.query_params.get("lesson")
        if lesson_id:
            lesson = JournalLesson.objects.filter(pk=lesson_id).first()
            if lesson is not None:
                attached_set_ids = set(
                    lesson.assessments.values_list("assessment_set_id", flat=True)
                )
                attached_pt_ids = set(int(x) for x in (lesson.practice_test_ids or []))
                attached_pack_ids = set(int(x) for x in (lesson.practice_test_pack_ids or []))

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

        return Response(
            {
                "subject": subject,
                "level": level,
                "classroom_subject": subject,  # frontend-picker compat keys
                "classroom_level": level,
                "practice_tests": practice_tests,
                "assessment_sets": assessment_sets,
                "practice_test_packs": practice_test_packs,
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
        "practice_scope",
        "assessment_set_ids",
        "practice_test_ids",
        "practice_test_pack_ids",
        "allow_file_upload",
        "due_after_days",
        "deadline_time",
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
                    {"detail": "Midterm lessons have no homework fields."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(_lesson_detail_response(lesson, request))

        from .serializers import JournalLessonWriteSerializer

        ser = JournalLessonWriteSerializer(lesson, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()

        if "practice_test_ids" in request.data:
            lesson.practice_test_ids = _parse_id_list(request.data.get("practice_test_ids")) or None
        if "practice_test_pack_ids" in request.data:
            lesson.practice_test_pack_ids = (
                _parse_id_list(request.data.get("practice_test_pack_ids")) or None
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
            lesson.allow_file_upload = False
            lesson.practice_test_ids = None
            lesson.practice_test_pack_ids = None
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
            lesson.external_url = src.external_url
            lesson.allow_file_upload = src.allow_file_upload
            lesson.practice_scope = src.practice_scope
            lesson.practice_test_ids = src.practice_test_ids
            lesson.practice_test_pack_ids = src.practice_test_pack_ids
            lesson.due_after_days = src.due_after_days
            lesson.deadline_time = src.deadline_time
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
