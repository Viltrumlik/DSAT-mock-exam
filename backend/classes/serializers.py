import json
import mimetypes
import os

from django.core.exceptions import ObjectDoesNotExist, ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema_field, extend_schema_serializer
from rest_framework import serializers
from urllib.parse import urlparse
from django.core.validators import URLValidator

from exams.models import MockExam, PracticeTest, PracticeTestPack

from .submission_validation import validate_submission_grade

from .models import (
    Classroom,
    ClassroomMaterial,
    ClassroomMembership,
    ClassPost,
    Assignment,
    Submission,
    SubmissionFile,
    SubmissionAuditEvent,
    ClassComment,
    assignment_target_practice_test_ids,
    filter_practice_targets_by_scope,
    grant_practice_test_library_access_for_assignment,
    raw_target_practice_test_ids_from_fks,
    submission_workflow_status,
)


@extend_schema_serializer(component_name="ClassroomTeacherDetails")
class ClassroomTeacherDetailsSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()
    username = serializers.CharField(allow_null=True, required=False)
    first_name = serializers.CharField(allow_blank=True, required=False)
    last_name = serializers.CharField(allow_blank=True, required=False)


@extend_schema_serializer(component_name="AssignmentAssessmentHomeworkSet")
class AssignmentAssessmentHomeworkSetSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    subject = serializers.CharField()
    category = serializers.CharField(allow_blank=True)
    title = serializers.CharField()
    description = serializers.CharField(allow_blank=True)


@extend_schema_serializer(component_name="AssignmentAssessmentHomework")
class AssignmentAssessmentHomeworkSerializer(serializers.Serializer):
    homework_id = serializers.IntegerField()
    set = AssignmentAssessmentHomeworkSetSerializer(allow_null=True, required=False)


@extend_schema_serializer(component_name="AssignmentPracticeBundleTest")
class AssignmentPracticeBundleTestSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    subject = serializers.CharField()


@extend_schema_serializer(component_name="AssignmentCreatedBy")
class AssignmentCreatedBySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()
    username = serializers.CharField(allow_null=True, required=False)
    first_name = serializers.CharField(allow_blank=True, required=False)
    last_name = serializers.CharField(allow_blank=True, required=False)


class ClassroomSerializer(serializers.ModelSerializer):
    members_count = serializers.IntegerField(read_only=True)
    my_role = serializers.SerializerMethodField(read_only=True)
    teacher_details = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Classroom
        fields = [
            "id",
            "name",
            "subject",
            "lesson_days",
            "lesson_time",
            "lesson_hours",
            "start_date",
            "room_number",
            "telegram_chat_id",
            "max_students",
            "teacher",
            "teacher_details",
            "join_code",
            "is_active",
            "schedule_summary",
            "created_at",
            "members_count",
            "my_role",
        ]
        read_only_fields = ["join_code", "created_at", "members_count"]

    def get_my_role(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        if not user or not getattr(user, "is_authenticated", False):
            return None
        mem = obj.memberships.filter(user=user).only("role").first()
        return mem.role if mem else None

    @extend_schema_field(ClassroomTeacherDetailsSerializer(allow_null=True, required=False, read_only=True))
    def get_teacher_details(self, obj):
        t = obj.teacher
        if not t:
            return None
        return {
            "id": t.id,
            "email": t.email,
            "username": getattr(t, "username", None),
            "first_name": t.first_name,
            "last_name": t.last_name,
        }


class ClassroomCreateSerializer(serializers.ModelSerializer):
    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Name is required.")
        if len(value) > 120:
            raise serializers.ValidationError("Name must be at most 120 characters.")
        return value

    def validate_max_students(self, value):
        if value is not None and value < 1:
            raise serializers.ValidationError("max_students must be at least 1.")
        return value

    def validate_lesson_hours(self, value):
        if value is not None and value < 1:
            raise serializers.ValidationError("lesson_hours must be at least 1.")
        return value

    def validate_teacher(self, value):
        from access import constants as acc_const
        from access.services import actor_subject_probe_for_domain_perm, authorize

        if value is None:
            return value
        if getattr(value, "is_frozen", False):
            raise serializers.ValidationError("Teacher cannot be a frozen account.")
        subj = actor_subject_probe_for_domain_perm(value)
        if subj and authorize(
            value,
            acc_const.PERM_MANAGE_USERS,
            subject=subj,
        ):
            return value
        # Allow keeping the current teacher on update so demoted users do not block all edits.
        instance = getattr(self, "instance", None)
        if instance is not None and instance.teacher_id == value.pk:
            return value
        raise serializers.ValidationError("Teacher must have user-management permission.")

    class Meta:
        model = Classroom
        fields = [
            "id",
            "name",
            "subject",
            "lesson_days",
            "lesson_time",
            "lesson_hours",
            "start_date",
            "room_number",
            "telegram_chat_id",
            "max_students",
            "teacher",
            "is_active",
            "schedule_summary",
            "join_code",
            "created_at",
        ]
        read_only_fields = ["id", "join_code", "created_at"]


class ClassroomMembershipSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()

    class Meta:
        model = ClassroomMembership
        fields = ["id", "role", "status", "joined_at", "user"]

    def get_user(self, obj):
        u = obj.user
        return {
            "id": u.id,
            "email": u.email,
            "username": getattr(u, "username", None),
            "first_name": u.first_name,
            "last_name": u.last_name,
            "profile_image_url": getattr(u, "profile_image", None).url if getattr(u, "profile_image", None) else None,
        }


class ClassPostSerializer(serializers.ModelSerializer):
    author = serializers.SerializerMethodField()
    content = serializers.CharField(max_length=50_000, trim_whitespace=False)

    class Meta:
        model = ClassPost
        fields = ["id", "content", "created_at", "author"]
        read_only_fields = ["id", "created_at", "author"]

    def validate_content(self, value):
        text = (value or "").strip()
        if not text:
            raise serializers.ValidationError("Announcement content cannot be empty.")
        return value

    def get_author(self, obj):
        u = obj.author
        return {
            "id": u.id,
            "email": u.email,
            "username": getattr(u, "username", None),
            "first_name": u.first_name,
            "last_name": u.last_name,
        }


class AssignmentSerializer(serializers.ModelSerializer):
    title = serializers.CharField(max_length=200)

    created_by = serializers.SerializerMethodField()
    submissions_count = serializers.IntegerField(read_only=True)
    attachment_file_url = serializers.SerializerMethodField(read_only=True)
    attachment_urls = serializers.SerializerMethodField(read_only=True)
    external_url = serializers.CharField(required=False, allow_blank=True)
    mock_exam = serializers.PrimaryKeyRelatedField(
        queryset=MockExam.objects.all(), required=False, allow_null=True
    )
    practice_test = serializers.PrimaryKeyRelatedField(
        queryset=PracticeTest.objects.all(), required=False, allow_null=True
    )
    practice_test_pack = serializers.PrimaryKeyRelatedField(
        queryset=PracticeTestPack.objects.all(), required=False, allow_null=True
    )
    practice_test_ids = serializers.JSONField(required=False, allow_null=True)
    practice_test_pack_ids = serializers.JSONField(required=False, allow_null=True)
    practice_scope = serializers.ChoiceField(
        choices=Assignment.PRACTICE_SCOPE_CHOICES,
        required=False,
        default=Assignment.PRACTICE_SCOPE_BOTH,
    )
    practice_bundle_tests = serializers.SerializerMethodField(read_only=True)
    locks_file_upload = serializers.SerializerMethodField(read_only=True)
    assessment_homework = serializers.SerializerMethodField(read_only=True)
    assessment_homeworks = serializers.SerializerMethodField(read_only=True)
    # Redesigned-homework metadata: an explicit content-type label, the openable
    # contents (each with its display name + item count for the launcher cards),
    # the dominant section subject, a task/item count for the "TASKS" tile, and the
    # "given" timestamp the student-facing ordering + "ASSIGNED" tile use.
    content_type = serializers.SerializerMethodField(read_only=True)
    contents = serializers.SerializerMethodField(read_only=True)
    item_count = serializers.SerializerMethodField(read_only=True)
    subject = serializers.SerializerMethodField(read_only=True)
    assigned_at = serializers.SerializerMethodField(read_only=True)
    # The requesting student's assessment attempt state, so the launcher shows
    # Start / Resume / Review (and never silently overwrites a finished attempt).
    assessment_progress = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Assignment
        fields = [
            "id",
            "title",
            "instructions",
            "due_at",
            "mock_exam",
            "practice_test",
            "practice_test_pack",
            "practice_test_ids",
            "practice_test_pack_ids",
            "practice_scope",
            "practice_bundle_tests",
            "locks_file_upload",
            "assessment_homework",
            "assessment_homeworks",
            "content_type",
            "contents",
            "item_count",
            "subject",
            "assigned_at",
            "assessment_progress",
            "module",
            "external_url",
            "attachment_file",
            "attachment_file_url",
            "attachment_urls",
            "category",
            "max_score",
            "status",
            "published_at",
            "archived_at",
            "created_at",
            "created_by",
            "submissions_count",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "created_by",
            "submissions_count",
            "practice_bundle_tests",
            "locks_file_upload",
            "attachment_urls",
            "published_at",
            "archived_at",
            "content_type",
            "contents",
            "item_count",
            "subject",
            "assigned_at",
        ]

    @extend_schema_field(serializers.BooleanField(read_only=True))
    def get_locks_file_upload(self, obj):
        """True when this homework includes assigned practice/mock sections (auto turn-in when tests finish)."""
        # Multi-content bundles are instructional — keep file upload available so a bundle
        # that includes a file deliverable can still be turned in.
        if getattr(obj, "is_multi_content", False):
            return False
        # Also lock for assessment homework (no file submissions / manual grading).
        return bool(assignment_target_practice_test_ids(obj) or obj.assessment_homeworks.exists())

    @staticmethod
    def _hw_list(obj):
        """Ordered assessment homeworks attached to this assignment (may be many)."""
        try:
            return list(obj.assessment_homeworks.all())
        except Exception:
            return []

    @staticmethod
    def _pack_ids(obj) -> list:
        """Deduped practice-pack ids on this assignment (legacy FK + multi list)."""
        out: list[int] = []
        seen: set[int] = set()
        if obj.practice_test_pack_id and obj.practice_test_pack_id not in seen:
            seen.add(obj.practice_test_pack_id)
            out.append(obj.practice_test_pack_id)
        for x in (obj.practice_test_pack_ids or []):
            try:
                v = int(x)
            except (TypeError, ValueError):
                continue
            if v not in seen:
                seen.add(v)
                out.append(v)
        return out

    @staticmethod
    def _pastpaper_only_ids(obj) -> list:
        """Explicit pastpaper section ids (practice_test_ids / practice_test),
        EXCLUDING pack-derived sections (packs are shown separately)."""
        raw = raw_target_practice_test_ids_from_fks(None, obj.practice_test_ids, obj.practice_test_id)
        scope = obj.practice_scope or Assignment.PRACTICE_SCOPE_BOTH
        return filter_practice_targets_by_scope(raw, scope)

    def _serialize_hw(self, hw):
        aset = getattr(hw, "assessment_set", None)
        set_payload = None if not aset else {
            "id": aset.id,
            "subject": aset.subject,
            "category": aset.category,
            "title": aset.title,
            "description": aset.description,
        }
        return {
            "homework_id": hw.id,
            "set": set_payload,
            # Per-assessment student state, so a bundle's launcher/board can show
            # each assessment's own Start/Continue/Review + score.
            "progress": self._hw_progress(hw, self._req_user()),
            "question_count": self._assessment_question_count(aset),
        }

    @extend_schema_field(AssignmentAssessmentHomeworkSerializer(allow_null=True, required=False, read_only=True))
    def get_assessment_homework(self, obj):
        """First attached assessment homework (back-compat singular; use
        ``assessment_homeworks`` for the full bundle)."""
        hws = self._hw_list(obj)
        return self._serialize_hw(hws[0]) if hws else None

    @extend_schema_field(AssignmentAssessmentHomeworkSerializer(many=True, read_only=True))
    def get_assessment_homeworks(self, obj):
        """Every assessment attached to this homework (a bundle can hold many)."""
        return [self._serialize_hw(hw) for hw in self._hw_list(obj)]

    @extend_schema_field(AssignmentCreatedBySerializer(read_only=True))
    def get_created_by(self, obj):
        u = obj.created_by
        return {
            "id": u.id,
            "email": u.email,
            "username": getattr(u, "username", None),
            "first_name": u.first_name,
            "last_name": u.last_name,
        }

    @extend_schema_field(serializers.URLField(allow_null=True, read_only=True))
    def get_attachment_file_url(self, obj):
        if not obj.attachment_file:
            return None
        request = self.context.get("request")
        url = obj.attachment_file.url
        if request:
            return request.build_absolute_uri(url)
        return url

    @extend_schema_field(
        serializers.ListField(
            child=serializers.DictField(),
            read_only=True,
            help_text="Attachment objects: { url, file_name, content_type, size }.",
        )
    )
    def get_attachment_urls(self, obj):
        """Primary file first, then extra attachments (same order as upload).

        Each entry is an object carrying the display filename + type so the student
        UI can show the right icon and a working download (not a bare URL string)."""
        request = self.context.get("request")

        def entry(filefield):
            name = filefield.name or ""
            file_name = os.path.basename(name)
            url = filefield.url
            try:
                size = filefield.size
            except Exception:
                size = None
            return {
                "url": request.build_absolute_uri(url) if request else url,
                "file_name": file_name,
                "content_type": mimetypes.guess_type(file_name)[0] or "",
                "size": size,
            }

        items = []
        if obj.attachment_file:
            items.append(entry(obj.attachment_file))
        for ex in obj.extra_attachments.all():
            items.append(entry(ex.file))
        return items

    @extend_schema_field(
        serializers.ListField(child=AssignmentPracticeBundleTestSerializer(), read_only=True),
    )
    def get_practice_bundle_tests(self, obj):
        ids = assignment_target_practice_test_ids(obj)
        if not ids:
            return []
        order = {"READING_WRITING": 0, "MATH": 1}
        pts = list(PracticeTest.objects.filter(id__in=ids))
        pts.sort(key=lambda p: (order.get(p.subject, 9), p.id))
        # Per-section attempt state for the requesting student (one query), so the
        # launcher renders Start / Resume / Review per section.
        states = self._exam_states([p.id for p in pts])
        return [
            {
                "id": p.id,
                "title": (p.title or "").strip(),
                # Standalone pastpaper sections are labelled by collection_name (title
                # is usually blank), so expose it + a ready display name for the launcher.
                "collection_name": (getattr(p, "collection_name", "") or "").strip(),
                "name": self._section_name(p),
                "subject": p.subject,
                "state": states[p.id]["state"],
                "attempt_id": states[p.id]["attempt_id"],
            }
            for p in pts
        ]

    def _req_user(self):
        """The authenticated requesting user, or None (anonymous / no request)."""
        req = self.context.get("request")
        u = getattr(req, "user", None)
        return u if (u is not None and getattr(u, "is_authenticated", False)) else None

    def _exam_states(self, ids):
        """Map {practice_test_id: {"state","attempt_id"}} for the requesting student.
        A completed attempt wins (→ review); else an active (started, non-abandoned)
        attempt (→ resume); else not_started. One query for all ids."""
        out = {tid: {"state": "not_started", "attempt_id": None} for tid in ids}
        user = self._req_user()
        if user is None or not ids:
            return out
        from exams.models import TestAttempt

        completed: dict[int, int] = {}
        active: dict[int, int] = {}
        rows = (
            TestAttempt.objects.filter(student=user, practice_test_id__in=ids)
            .order_by("practice_test_id", "-id")
            .values("id", "practice_test_id", "is_completed", "current_state")
        )
        for r in rows:  # ordered -id → first seen per test is the latest
            tid = r["practice_test_id"]
            if r["is_completed"] and r["current_state"] == TestAttempt.STATE_COMPLETED:
                completed.setdefault(tid, r["id"])
            elif r["current_state"] not in (TestAttempt.STATE_NOT_STARTED, TestAttempt.STATE_ABANDONED):
                active.setdefault(tid, r["id"])
        for tid in ids:
            if tid in completed:
                out[tid] = {"state": "completed", "attempt_id": completed[tid]}
            elif tid in active:
                out[tid] = {"state": "in_progress", "attempt_id": active[tid]}
        return out

    def _hw_progress(self, hw, user):
        """The requesting student's attempt state for ONE assessment homework:
        {state, attempt_id, + score/answered fields}."""
        if user is None or hw is None:
            return {"state": "not_started", "attempt_id": None}
        from assessments.models import AssessmentAttempt

        att = (
            AssessmentAttempt.objects.filter(homework=hw, student=user)
            .order_by("-started_at", "-id")
            .first()
        )
        if att is None:
            return {"state": "not_started", "attempt_id": None}
        # Total questions in the set — used for the progress bar / score denominator.
        total = self._assessment_question_count(getattr(hw, "assessment_set", None))
        if att.status in ("submitted", "graded"):
            # Surface the graded result inline so the completed card ("pack") can show
            # the score, correct count, and how many were missed without a second fetch.
            result = getattr(att, "result", None)
            payload = {"state": "completed", "attempt_id": att.id, "total_questions": total}
            if result is not None:
                correct = int(result.correct_count or 0)
                res_total = int(result.total_questions or total or 0)
                payload.update(
                    {
                        "graded": True,
                        "percent": round(float(result.percent or 0)),
                        "correct_count": correct,
                        "total_questions": res_total,
                        "missed_count": max(res_total - correct, 0),
                    }
                )
            else:
                # Submitted but not yet graded — no score to show.
                payload["graded"] = False
            return payload
        if att.status == "in_progress":
            answered = att.answers.exclude(answer__isnull=True).count()
            last_activity = getattr(att, "last_activity_at", None) or att.started_at
            return {
                "state": "in_progress",
                "attempt_id": att.id,
                "answered_count": answered,
                "total_questions": total,
                "last_activity_at": last_activity.isoformat() if last_activity else None,
            }
        return {"state": "not_started", "attempt_id": att.id}

    @extend_schema_field(serializers.DictField(allow_null=True, read_only=True))
    def get_assessment_progress(self, obj):
        """Back-compat: progress for the FIRST attached assessment (per-assessment
        progress for a bundle lives in each ``assessment_homeworks`` item)."""
        hws = self._hw_list(obj)
        if not hws:
            return {"state": "not_started", "attempt_id": None}
        return self._hw_progress(hws[0], self._req_user())

    @staticmethod
    def _section_name(pt) -> str:
        """Display name for a standalone pastpaper section: collection_name first
        (sections are labelled by it; title is usually blank), then title."""
        return (
            (getattr(pt, "collection_name", "") or "").strip()
            or (getattr(pt, "title", "") or "").strip()
            or "Past Paper"
        )

    # ---- Redesigned-homework helpers -------------------------------------

    @staticmethod
    def _practice_item_count(ids) -> int:
        """Total questions across the modules of the given practice-test ids."""
        if not ids:
            return 0
        pts = PracticeTest.objects.filter(id__in=ids).prefetch_related("modules__questions")
        return sum(m.questions.count() for pt in pts for m in pt.modules.all())

    @staticmethod
    def _assessment_question_count(aset) -> int:
        if aset is None:
            return 0
        qs = getattr(aset, "questions", None)
        if qs is None:
            return 0
        try:
            return qs.filter(is_active=True).count()
        except Exception:
            return qs.count()

    @extend_schema_field(serializers.CharField(read_only=True))
    def get_content_type(self, obj):
        """Explicit type label mirroring the frontend AssignmentKind precedence."""
        try:
            if obj.assessment_homeworks.exists():
                return "assessment"
        except Exception:
            pass
        if obj.mock_exam_id:
            return "mock"
        if obj.practice_test_pack_id or obj.practice_test_pack_ids:
            return "practice"
        if obj.practice_test_id or obj.practice_test_ids:
            return "pastpaper"
        if obj.module_id:
            return "module"
        return "file"

    @extend_schema_field(serializers.ListField(child=serializers.DictField(), read_only=True))
    def get_contents(self, obj):
        """Openable contents in the same order the launcher renders them (assessment,
        mock, practice pack, past paper). Each carries a display name + item count so the
        redesigned homework cards can show the content's real name with its Start button.
        Files/links stay in the Details card and are intentionally excluded."""
        out = []
        # One QUIZ launcher per attached assessment (a bundle can hold many), each
        # carrying its homework_id so the launcher/board can deep-link to that quiz.
        for hw in self._hw_list(obj):
            aset = getattr(hw, "assessment_set", None)
            out.append({
                "kind": "QUIZ",
                "title": (getattr(aset, "title", None) or "Assessment"),
                "item_count": self._assessment_question_count(aset),
                "homework_id": hw.id,
            })
        if obj.mock_exam_id:
            mock = obj.mock_exam
            out.append({
                "kind": "MOCK",
                "title": (getattr(mock, "title", None) or getattr(mock, "name", None) or "Mock Exam"),
                "item_count": self._practice_item_count(assignment_target_practice_test_ids(obj)),
            })
        # One PRACTICE launcher per attached pack (legacy single FK + the multi list).
        pack_ids = self._pack_ids(obj)
        if pack_ids:
            packs = {p.id: p for p in PracticeTestPack.objects.filter(id__in=pack_ids)}
            scope = obj.practice_scope or Assignment.PRACTICE_SCOPE_BOTH
            for pid in pack_ids:
                pack = packs.get(pid)
                sec_ids = filter_practice_targets_by_scope(
                    raw_target_practice_test_ids_from_fks(None, None, None, practice_test_pack_id=pid), scope
                )
                out.append({
                    "kind": "PRACTICE",
                    "title": (getattr(pack, "title", None) or getattr(pack, "name", None) or "Practice Test"),
                    "item_count": self._practice_item_count(sec_ids),
                })
        # Explicit pastpaper sections (practice_test_ids / practice_test) — pack
        # sections are shown as PRACTICE above, so exclude them here.
        pastpaper_ids = self._pastpaper_only_ids(obj)
        if pastpaper_ids:
            ids = pastpaper_ids
            sections = list(PracticeTest.objects.filter(id__in=ids)) if ids else []
            names = {self._section_name(s) for s in sections}
            names.discard("Past Paper")
            if len(sections) == 1:
                title = self._section_name(sections[0])
            elif len(names) == 1:
                # A full paper (e.g. R&W + Math sections sharing one collection_name).
                title = next(iter(names))
            elif len(sections) > 1:
                title = f"Past Paper · {len(sections)} sections"
            else:
                title = "Past Paper"
            out.append({
                "kind": "PASTPAPER",
                "title": title,
                "item_count": self._practice_item_count(ids),
            })
        return out

    @extend_schema_field(serializers.IntegerField(read_only=True))
    def get_item_count(self, obj):
        """Task/item count for the homework 'TASKS' tile — questions for the dominant
        content, or attachment count for a file deliverable."""
        ct = self.get_content_type(obj)
        if ct == "assessment":
            # Sum questions across every attached assessment.
            return sum(
                self._assessment_question_count(getattr(hw, "assessment_set", None))
                for hw in self._hw_list(obj)
            )
        if ct in ("pastpaper", "practice", "mock"):
            return self._practice_item_count(assignment_target_practice_test_ids(obj))
        if ct == "file":
            n = 1 if obj.attachment_file else 0
            try:
                n += obj.extra_attachments.count()
            except Exception:
                pass
            return n or 1
        return 0

    @extend_schema_field(serializers.CharField(allow_null=True, read_only=True))
    def get_subject(self, obj):
        """Dominant section subject for the 'SECTION' tile (assessment set / past paper
        section subject), falling back to the classroom subject."""
        try:
            hws = self._hw_list(obj)
            if hws and getattr(hws[0], "assessment_set", None) is not None:
                return hws[0].assessment_set.subject
        except Exception:
            pass
        ids = assignment_target_practice_test_ids(obj)
        if ids:
            pt = PracticeTest.objects.filter(id__in=ids).first()
            if pt is not None:
                return getattr(pt, "subject", None)
        classroom = getattr(obj, "classroom", None)
        return getattr(classroom, "subject", None)

    @extend_schema_field(serializers.DateTimeField(allow_null=True, read_only=True))
    def get_assigned_at(self, obj):
        return obj.published_at or obj.created_at

    def validate_title(self, value):
        text = (value or "").strip()
        if not text:
            raise serializers.ValidationError("Title is required.")
        return text

    def validate_practice_test_ids(self, value):
        if value is None:
            return None
        if isinstance(value, str):
            s = value.strip()
            if not s or s == "null":
                return None
            value = json.loads(s)
        if not isinstance(value, list):
            raise serializers.ValidationError("practice_test_ids must be a list of integers.")
        if len(value) == 0:
            return None
        out = [int(x) for x in value]
        if len(out) != len(set(out)):
            raise serializers.ValidationError("Duplicate practice test ids.")
        return out

    def validate_practice_test_pack_ids(self, value):
        if value is None:
            return None
        if isinstance(value, str):
            s = value.strip()
            if not s or s == "null":
                return None
            value = json.loads(s)
        if not isinstance(value, list):
            raise serializers.ValidationError("practice_test_pack_ids must be a list of integers.")
        if len(value) == 0:
            return None
        out = [int(x) for x in value]
        if len(out) != len(set(out)):
            raise serializers.ValidationError("Duplicate practice test pack ids.")
        return out

    def validate(self, attrs):
        inst = self.instance

        if inst is not None:
            for fk in ("mock_exam", "practice_test"):
                if fk in attrs and attrs[fk] == "":
                    attrs[fk] = None
            if "practice_test_ids" in attrs:
                v = attrs["practice_test_ids"]
                if v in (None, "", []):
                    attrs["practice_test_ids"] = None
        else:
            # CREATE: instructions are mandatory on new homework (teacher form enforces
            # this client-side too). Only checked on create so publish/archive actions and
            # existing PATCH flows are never forced to resend instructions.
            if not (attrs.get("instructions") or "").strip():
                raise serializers.ValidationError(
                    {"instructions": "Instructions are required."}
                )
            # CREATE: multi-content is allowed — a single assignment may bundle a file,
            # a past paper section, an assessment and a practice test at once. Normalize
            # each field independently ("" -> None) and only collapse WITHIN the practice
            # slot (legacy ids vs single describe the same rows). Do NOT null one content
            # type because another is present.
            if attrs.get("practice_test") == "":
                attrs["practice_test"] = None
            pids = attrs.get("practice_test_ids")
            if pids in (None, "", []):
                attrs["practice_test_ids"] = None
            elif len(pids) == 1 and not attrs.get("practice_test"):
                # Mirror a single-id legacy bundle to the canonical practice_test FK.
                attrs["practice_test"] = PracticeTest.objects.filter(
                    pk=pids[0], mock_exam__isnull=True
                ).first()

        attrs = super().validate(attrs)

        mock_id = None
        if "mock_exam" in attrs:
            m = attrs["mock_exam"]
            mock_id = m.pk if m else None
        elif inst is not None:
            mock_id = inst.mock_exam_id

        pt_id = None
        if "practice_test" in attrs:
            t = attrs["practice_test"]
            pt_id = t.pk if t else None
        elif inst is not None:
            pt_id = inst.practice_test_id

        pids = attrs["practice_test_ids"] if "practice_test_ids" in attrs else (
            inst.practice_test_ids if inst is not None else None
        )

        scope = attrs.get("practice_scope")
        if scope is None:
            scope = inst.practice_scope if inst is not None else Assignment.PRACTICE_SCOPE_BOTH
        if not scope:
            scope = Assignment.PRACTICE_SCOPE_BOTH
        attrs["practice_scope"] = scope

        raw = raw_target_practice_test_ids_from_fks(mock_id, pids, pt_id)
        filtered = filter_practice_targets_by_scope(raw, scope)
        if scope != Assignment.PRACTICE_SCOPE_BOTH and raw and not filtered:
            raise serializers.ValidationError(
                {
                    "practice_scope": "No section matches this choice for the selected mock or section (e.g. Math-only choice on an English-only test)."
                }
            )

        return attrs

    def create(self, validated_data):
        inst = super().create(validated_data)
        grant_practice_test_library_access_for_assignment(inst)
        return inst

    def update(self, instance, validated_data):
        inst = super().update(instance, validated_data)
        grant_practice_test_library_access_for_assignment(inst)
        return inst

    def validate_external_url(self, value):
        """
        Accept plain domains like `example.com/file.pdf` by normalizing to https.
        """
        value = (value or "").strip()
        if not value:
            return ""
        parsed = urlparse(value)
        normalized = value if parsed.scheme else f"https://{value}"
        # Reuse DRF URL validator via URLField
        URLValidator()(normalized)
        return normalized


class SubmissionFileSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = SubmissionFile
        fields = ["id", "url", "file_name", "file_type", "created_at"]
        read_only_fields = fields

    def get_url(self, obj):
        request = self.context.get("request")
        url = obj.file.url
        if request:
            return request.build_absolute_uri(url)
        return url


class SubmissionSerializer(serializers.ModelSerializer):
    student = serializers.SerializerMethodField()
    files = SubmissionFileSerializer(many=True, read_only=True)
    attempt = serializers.SerializerMethodField()
    review = serializers.SerializerMethodField()
    workflow_status = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = [
            "id",
            "status",
            "revision",
            "return_note",
            "returned_at",
            "files",
            "attempt",
            "submitted_at",
            "updated_at",
            "student",
            "review",
            "workflow_status",
        ]
        read_only_fields = [
            "id",
            "revision",
            "submitted_at",
            "updated_at",
            "student",
            "review",
            "workflow_status",
            "return_note",
            "returned_at",
        ]

    def get_workflow_status(self, obj):
        return submission_workflow_status(obj)

    def get_student(self, obj):
        u = obj.student
        return {
            "id": u.id,
            "email": u.email,
            "username": getattr(u, "username", None),
            "first_name": u.first_name,
            "last_name": u.last_name,
        }

    def get_review(self, obj):
        try:
            r = obj.review
        except ObjectDoesNotExist:
            return None
        t = r.teacher
        # When status is RETURNED, the linked review (if any) is from the prior cycle — not the active grade.
        if obj.status == Submission.STATUS_RETURNED:
            review_context = "previous_cycle"
        elif obj.status == Submission.STATUS_REVIEWED:
            review_context = "current"
        else:
            review_context = "historical"
        return {
            "grade": str(r.grade) if r.grade is not None else None,
            "max_score": str(r.max_score) if r.max_score is not None else None,
            "feedback": r.feedback,
            "is_auto": r.is_auto,
            "reviewed_at": r.reviewed_at,
            "review_context": review_context,
            "teacher": {
                "id": t.id,
                "email": t.email,
                "first_name": t.first_name,
                "last_name": t.last_name,
            },
        }

    def get_attempt(self, obj):
        a = obj.attempt
        if not a:
            return None
        pt = a.practice_test
        name = (getattr(pt, "title", None) or "").strip() or None
        return {
            "id": a.id,
            "practice_test": pt.id,
            "practice_test_name": name or f"Test #{pt.id}",
            "is_completed": a.is_completed,
            "score": a.score,
            "submitted_at": a.submitted_at,
        }


class SubmitSerializer(serializers.Serializer):
    # Accept "" from multipart forms to clear the linked attempt; integers still allowed.
    attempt_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    remove_file_ids = serializers.CharField(required=False, allow_blank=True)
    # Optimistic locking: last known ``Submission.revision`` from GET my-submission.
    expected_revision = serializers.IntegerField(required=False, allow_null=True)
    # JSON array of per-file tokens (same order as ``files``) for idempotent retries.
    file_tokens = serializers.CharField(required=False, allow_blank=True)

    def validate_attempt_id(self, value):
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            raise serializers.ValidationError("Invalid attempt id.")

    submit = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        import json
        import uuid

        raw = attrs.get("file_tokens")
        tokens: list[str] = []
        if raw:
            try:
                if isinstance(raw, str):
                    arr = json.loads(raw) if raw.strip().startswith("[") else []
                else:
                    arr = raw
                if isinstance(arr, list):
                    tokens = [str(x)[:64] for x in arr]
            except (json.JSONDecodeError, TypeError, ValueError):
                tokens = []
        attrs["file_tokens_list"] = tokens

        n = self.context.get("new_files_count")
        if n is not None and int(n) > 0:
            need = int(n)
            # Backward compatibility: allow file uploads without client-supplied file_tokens.
            # Auto-generate per-file tokens so older clients can still upload successfully.
            if len(tokens) < need:
                for _ in range(need - len(tokens)):
                    tokens.append(uuid.uuid4().hex[:64])
                attrs["file_tokens_list"] = tokens
            need_tokens: list[str] = []
            for i, t in enumerate(tokens[:need]):
                ts = str(t).strip()
                if len(ts) < 8:
                    raise serializers.ValidationError(
                        {"file_tokens": f"Token at index {i} must be at least 8 characters."}
                    )
                need_tokens.append(ts[:64])

            if len(set(need_tokens)) < len(need_tokens):
                raise serializers.ValidationError(
                    {"file_tokens": "Duplicate upload_token values in the same request are not allowed."}
                )

            sub_id = self.context.get("submission_id")
            remove_pks = self.context.get("remove_file_ids") or []
            if sub_id is not None:
                from .models import SubmissionFile

                existing_qs = SubmissionFile.objects.filter(submission_id=sub_id).exclude(upload_token="")
                if remove_pks:
                    existing_qs = existing_qs.exclude(pk__in=remove_pks)
                used = set(existing_qs.values_list("upload_token", flat=True))
                for i, tok in enumerate(need_tokens):
                    if tok in used:
                        raise serializers.ValidationError(
                            {
                                "file_tokens": (
                                    f"Token at index {i} is already used by another file on this submission. "
                                    "Use a new token per upload, or remove the existing file first."
                                )
                            }
                        )
        return attrs


class SubmissionReturnSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=10_000)
    expected_revision = serializers.IntegerField(required=False, allow_null=True)


class SubmissionAuditEventReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubmissionAuditEvent
        fields = ["id", "event_type", "payload", "created_at", "actor_id"]
        read_only_fields = fields


class SubmissionReviewUpsertSerializer(serializers.Serializer):
    grade = serializers.DecimalField(required=False, max_digits=6, decimal_places=2, allow_null=True)
    feedback = serializers.CharField(required=False, allow_blank=True)
    score = serializers.DecimalField(required=False, max_digits=6, decimal_places=2, allow_null=True)
    expected_revision = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        if "score" in attrs and "grade" not in attrs:
            attrs["grade"] = attrs.get("score")
        g = attrs.get("grade")
        if g is not None:
            try:
                validate_submission_grade(g)
            except DjangoValidationError as e:
                raise serializers.ValidationError({"grade": e.messages[0] if e.messages else str(e)})
        return attrs


class ClassCommentSerializer(serializers.ModelSerializer):
    author = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ClassComment
        fields = ["id", "classroom", "target_type", "target_id", "parent", "content", "author", "created_at", "updated_at"]
        read_only_fields = ["id", "classroom", "author", "created_at", "updated_at"]

    def get_author(self, obj):
        u = obj.author
        return {
            "id": u.id,
            "email": u.email,
            "username": getattr(u, "username", None),
            "first_name": u.first_name,
            "last_name": u.last_name,
        }

    def validate_content(self, value):
        text = (value or "").strip()
        if not text:
            raise serializers.ValidationError("Comment cannot be empty.")
        if len(text) > 10_000:
            raise serializers.ValidationError("Comment is too long.")
        return text

    def validate(self, attrs):
        classroom = attrs.get("classroom") or self.context.get("classroom") or (
            self.instance.classroom if self.instance else None
        )
        t_type = attrs.get("target_type") or (self.instance.target_type if self.instance else None)
        t_id = attrs.get("target_id") if "target_id" in attrs else (self.instance.target_id if self.instance else None)
        parent = attrs.get("parent") if "parent" in attrs else None
        if parent is None and self.instance:
            parent = self.instance.parent
        if classroom and t_type and t_id is not None:
            if t_type == ClassComment.TARGET_POST:
                if not ClassPost.objects.filter(pk=t_id, classroom=classroom).exists():
                    raise serializers.ValidationError({"target_id": "Announcement not found in this class."})
            elif t_type == ClassComment.TARGET_ASSIGNMENT:
                if not Assignment.objects.filter(pk=t_id, classroom=classroom).exists():
                    raise serializers.ValidationError({"target_id": "Assignment not found in this class."})
        if parent and classroom:
            if parent.classroom_id != classroom.pk or parent.target_type != t_type or parent.target_id != t_id:
                raise serializers.ValidationError({"parent": "Reply must belong to the same thread."})
        return attrs


class ClassroomMaterialSerializer(serializers.ModelSerializer):
    """Read serializer for downloadable classroom materials."""

    file_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = ClassroomMaterial
        fields = [
            "id", "title", "description", "file_url", "file_name", "file_size",
            "teacher_name", "created_at",
        ]
        read_only_fields = fields

    def get_file_url(self, obj) -> str | None:
        if not obj.file:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url

    def get_file_name(self, obj) -> str | None:
        if not obj.file:
            return None
        return os.path.basename(obj.file.name)

    def get_file_size(self, obj) -> int | None:
        """Size in bytes (drives the '2.4 MB' meta line). None if unreadable."""
        if not obj.file:
            return None
        try:
            return obj.file.size
        except (OSError, ValueError):
            return None

    def get_teacher_name(self, obj) -> str | None:
        u = obj.teacher
        if not u:
            return None
        full = f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip()
        return full or getattr(u, "email", None)

