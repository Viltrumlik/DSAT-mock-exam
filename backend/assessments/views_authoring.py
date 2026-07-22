from __future__ import annotations

from django.db import transaction
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
import logging
from access.permissions import (
    CanAuthorAssessmentContent,
    CanViewTests,
)
from access.services import (
    is_global_scope_staff,
    normalized_role,
    user_domain_subject,
)
from access import constants as acc_const
from users.permissions import IsAuthenticatedAndNotFrozen
from .models import (
    AssessmentSet,
    AssessmentSetVersion,
    AssessmentQuestion,
)
from .serializers import (
    AssessmentSetSerializer,
    AssessmentSetAdminSerializer,
    AssessmentSetAdminWriteSerializer,
    AssessmentSetVersionSerializer,
    AdminPublishResponseSerializer,
    AssessmentQuestionAdminWriteSerializer,
    ApiAssessmentDetailSerializer,
)
from .services.authoring_service import create_question, reorder_questions
from .domain.csv_import import decode_csv, parse_rows
from .domain.question_ordering import dense_compact_set_orders_locked
from .domain.governance_events import emit_governance_event
from .models import GovernanceEvent


def _hidden_from_test_admin(actor, inst) -> bool:
    """
    A test_admin only manages the sets THEY authored. On detail endpoints
    (get/patch/delete) another author's set must look like it doesn't exist,
    so a test_admin can't open, edit or delete it by guessing its id. admin,
    super_admin and superusers are unaffected.
    """
    return (
        normalized_role(actor) == acc_const.ROLE_TEST_ADMIN
        and not getattr(actor, "is_superuser", False)
        and inst.created_by_id != getattr(actor, "id", None)
    )


def _demote_approved_set(set_id: int, actor, *, reason: str, correlation_id: str = "") -> bool:
    """
    An APPROVED set that is edited (metadata or questions changed) is no longer
    "checked" — drop it back to needs_review so it must be re-approved before it is
    treated as safe to assign. No-op for draft/needs_review sets. Cheap-guarded so the
    common (non-approved) edit does not take a row lock. Emits a GovernanceEvent.
    """
    if not AssessmentSet.objects.filter(
        pk=set_id, review_status=AssessmentSet.STATUS_APPROVED
    ).exists():
        return False
    with transaction.atomic():
        locked = AssessmentSet.objects.select_for_update().get(pk=set_id)
        if locked.review_status != AssessmentSet.STATUS_APPROVED:
            return False
        locked.review_status = AssessmentSet.STATUS_NEEDS_REVIEW
        locked.save(update_fields=["review_status", "updated_at"])
        emit_governance_event(
            event_type=GovernanceEvent.EVENT_SEND_BACK,
            actor=actor,
            entity_type="AssessmentSet",
            entity_id=set_id,
            payload={"from": "approved", "to": "needs_review", "reason": reason},
            correlation_id=(correlation_id or "")[:128],
        )
    return True


def _deny_cross_subject(request, wanted_subject):
    """403 when a non-global-staff actor writes content outside their own domain subject.

    Global staff (admin / test_admin / super_admin / superuser) author across subjects;
    a teacher is confined to theirs. ``wanted_subject`` is the subject being written —
    ``None``/blank means the payload does not change it, which is always allowed.
    """
    actor = request.user
    if is_global_scope_staff(actor) or getattr(actor, "is_superuser", False):
        return None
    ds = user_domain_subject(actor)
    wanted = str(wanted_subject or "").strip().lower()
    if ds and wanted and wanted != ds:
        return Response(
            {"detail": f"You can only author {ds} content."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


class AdminAssessmentSetListCreateView(APIView):
    # Default; method-specific permissions are enforced in get_permissions().
    permission_classes = [IsAuthenticatedAndNotFrozen]

    def get_permissions(self):
        if (self.request.method or "GET").upper() == "GET":
            return [p() for p in (IsAuthenticatedAndNotFrozen, CanViewTests)]
        return [p() for p in (IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent)]

    def get(self, request):
        subject = (request.query_params.get("subject") or "").strip().lower()
        category = (request.query_params.get("category") or "").strip()
        qs = AssessmentSet.objects.all().select_related("created_by").prefetch_related("questions")

        # Subject scoping:
        # - teachers: forced to their own domain subject (ignore query param)
        # - admin/test_admin/super_admin: may see all subjects; optional filter via query param
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds in (acc_const.DOMAIN_MATH, acc_const.DOMAIN_ENGLISH):
                qs = qs.filter(subject=ds)
        else:
            if subject in (acc_const.DOMAIN_MATH, acc_const.DOMAIN_ENGLISH):
                qs = qs.filter(subject=subject)

        # Creator scoping: a test_admin only manages the sets THEY authored — other
        # authors' sets are hidden. admin/super_admin (and superusers) still see all.
        actor_role = normalized_role(actor)
        if actor_role == acc_const.ROLE_TEST_ADMIN and not getattr(actor, "is_superuser", False):
            qs = qs.filter(created_by=actor)

        if category:
            qs = qs.filter(category__iexact=category)
        qs = qs.order_by("-created_at", "-id")

        # Creator attribution is exposed to super_admin only (see AssessmentSetSerializer).
        expose_creator = actor_role == acc_const.ROLE_SUPER_ADMIN or getattr(actor, "is_superuser", False)
        ser_ctx = {"expose_creator": expose_creator}

        paginator = LimitOffsetPagination()
        paginator.default_limit = 50
        paginator.max_limit = 200
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            return paginator.get_paginated_response(
                AssessmentSetSerializer(page, many=True, context=ser_ctx).data
            )
        return Response(AssessmentSetSerializer(qs, many=True, context=ser_ctx).data)

    def post(self, request):
        # Teacher scoping on CREATE. The detail endpoints have carried this guard all
        # along (get/patch 404 on a subject mismatch) but create never did, so a math
        # teacher could author an ENGLISH set: CanAuthorAssessmentContent only probes the
        # ACTOR's own subject and never looks at the subject in the payload.
        denied = _deny_cross_subject(request, (request.data or {}).get("subject"))
        if denied:
            return denied
        s = AssessmentSetAdminWriteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        inst = s.save(created_by=request.user)
        inst = AssessmentSet.objects.filter(pk=inst.pk).prefetch_related("questions").first()
        return Response(AssessmentSetSerializer(inst).data, status=status.HTTP_201_CREATED)


class AdminAssessmentSetDetailView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen]

    def get_permissions(self):
        if (self.request.method or "GET").upper() == "GET":
            return [p() for p in (IsAuthenticatedAndNotFrozen, CanViewTests)]
        return [p() for p in (IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent)]

    def get(self, request, pk: int):
        inst = get_object_or_404(AssessmentSet.objects.select_related("created_by").prefetch_related("questions"), pk=pk)
        # Teacher scoping defense-in-depth (detail endpoints).
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds and inst.subject != ds:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if _hidden_from_test_admin(actor, inst):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        # Use admin serializer so the builder UI receives correct_answer + grading_config
        # (the student-facing AssessmentSetSerializer intentionally omits correct_answer).
        return Response(AssessmentSetAdminSerializer(inst).data)

    def patch(self, request, pk: int):
        inst = get_object_or_404(AssessmentSet, pk=pk)
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds and inst.subject != ds:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if _hidden_from_test_admin(actor, inst):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        # The check above guards the set's CURRENT subject; this one stops a teacher
        # moving their own set into another domain.
        denied = _deny_cross_subject(request, (request.data or {}).get("subject"))
        if denied:
            return denied
        s = AssessmentSetAdminWriteSerializer(inst, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        # A metadata edit (title/category/source/level/description/subject) un-approves
        # the set; a pure is_active toggle (archive/unarchive) does NOT.
        meta_changed = bool(set(s.validated_data.keys()) - {"is_active"})
        inst = s.save()
        if meta_changed:
            _demote_approved_set(
                inst.pk, actor, reason="metadata_edited",
                correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
            )
        inst = AssessmentSet.objects.filter(pk=inst.pk).prefetch_related("questions").first()
        return Response(AssessmentSetSerializer(inst).data)

    def delete(self, request, pk: int):
        inst = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=pk)
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds and inst.subject != ds:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if _hidden_from_test_admin(actor, inst):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        # A set that was ever published (has a version) or assigned to a class is an
        # academic record protected by on_delete=PROTECT — a bare delete() would 500.
        # Block it by default; the author can deactivate it, or pass ?force=true to
        # remove it ALONG WITH its student attempts/grades and homework links.
        force = str(request.query_params.get("force", "")).strip().lower() in ("1", "true", "yes", "on")
        has_refs = (
            inst.versions.exists()
            or inst.homework_assignments.exists()
            or inst.homework_audit_events.exists()
        )

        # Audit BEFORE the row is gone. A deleted set is a permanent loss with no
        # other trail (created_by identifies the AUTHOR, not the deleter), so record
        # who deleted it into the immutable GovernanceEvent store. entity_id is a bare
        # BigInteger (not a FK), so the event survives the set's deletion. Emitted
        # inside the delete transaction below, so it rolls back iff the delete does.
        def _emit_delete_audit() -> None:
            emit_governance_event(
                event_type=GovernanceEvent.EVENT_SET_DELETE,
                actor=actor,
                entity_type="AssessmentSet",
                entity_id=inst.pk,
                payload={
                    "set_id": inst.pk,
                    "title": inst.title,
                    "subject": inst.subject,
                    "level": inst.level,
                    "category": inst.category,
                    "created_by_id": inst.created_by_id,
                    "created_by_email": getattr(inst.created_by, "email", None),
                    "force": bool(force and has_refs),
                    "had_refs": bool(has_refs),
                },
                # Truncate to the column width (128): an over-length client header
                # would otherwise raise a DataError that, inside the delete
                # transaction, poisons it on Postgres and 500s the delete.
                correlation_id=(request.META.get("HTTP_X_REQUEST_ID", "") or "")[:128],
            )

        if has_refs and not force:
            return Response(
                {
                    "detail": (
                        "This set has been published or assigned to a class. Deactivate it, "
                        "or force-delete to remove it along with its student attempts and grades."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        if force and has_refs:
            # DESTRUCTIVE force-delete. Remove everything that PROTECTs the set, in
            # dependency order, inside one transaction:
            #   1. student attempts (cascades their answers, results, audit events)
            #   2. homework links (the classroom homework loses this assessment)
            #   3. assessment homework audit events
            #   4. version snapshots — bulk QuerySet.delete() bypasses the per-instance
            #      immutability guard (INV-S02); drop the self-referential lineage first
            #      so PROTECT on previous_version doesn't block the bulk delete
            # Then the set itself (its questions cascade).
            from django.db.models import Q
            from .models import (
                AssessmentAttempt,
                HomeworkAssignment,
                AssessmentHomeworkAuditEvent,
            )
            try:
                with transaction.atomic():
                    AssessmentAttempt.objects.filter(
                        Q(homework__assessment_set=inst) | Q(set_version__assessment_set=inst)
                    ).delete()
                    HomeworkAssignment.objects.filter(assessment_set=inst).delete()
                    AssessmentHomeworkAuditEvent.objects.filter(assessment_set=inst).delete()
                    AssessmentSetVersion.objects.filter(assessment_set=inst).update(previous_version=None)
                    AssessmentSetVersion.objects.filter(assessment_set=inst).delete()
                    _emit_delete_audit()
                    inst.delete()
            except ProtectedError:
                return Response(
                    {"detail": "This set is still referenced by protected records and could not be force-deleted."},
                    status=status.HTTP_409_CONFLICT,
                )
            return Response(status=status.HTTP_204_NO_CONTENT)

        try:
            with transaction.atomic():
                _emit_delete_audit()
                inst.delete()
        except ProtectedError:
            # Belt-and-suspenders: a PROTECT relation added later would land here.
            return Response(
                {"detail": "This set is referenced elsewhere and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


_bank_sync_logger = logging.getLogger(__name__)


def _sync_question_to_bank(q) -> None:
    """Best-effort mirror of an authored assessment question into the Question Bank.
    Runs after commit; a failure is logged but never blocks assessment authoring."""
    def _run():
        try:
            from .domain.bank_sync import sync_assessment_question_to_bank
            sync_assessment_question_to_bank(q)
        except Exception:  # noqa: BLE001
            _bank_sync_logger.exception(
                "assessment→bank sync failed for question %s", getattr(q, "pk", None)
            )

    transaction.on_commit(_run)


class AdminAssessmentQuestionCreateView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def post(self, request, set_pk: int):
        aset = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=set_pk)
        if _hidden_from_test_admin(request.user, aset):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        # Pass request.data through UNTOUCHED. Spreading a multipart QueryDict into a
        # plain dict wraps every value in a single-element list and breaks JSON/file
        # field parsing — the cause of the create-with-image 400s. assessment_set and
        # order are server-owned (read-only on the serializer) and injected by the
        # authoring service under a set row-lock.
        s = AssessmentQuestionAdminWriteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        q = create_question(aset, s)
        _sync_question_to_bank(q)
        _demote_approved_set(
            aset.pk, request.user, reason="question_added",
            correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
        )
        return Response(AssessmentQuestionAdminWriteSerializer(q).data, status=status.HTTP_201_CREATED)


class AdminAssessmentQuestionDetailView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def _scoped_question_or_none(self, request, pk: int):
        """Fetch a question, enforcing the same subject scoping the set-level
        authoring endpoints use: a teacher may only edit/delete questions in
        their own domain subject; global staff / superusers are unrestricted.
        Returns None when out of scope (caller returns 404 — never leak).
        """
        q = get_object_or_404(
            AssessmentQuestion.objects.select_related("assessment_set", "assessment_set__created_by"), pk=pk
        )
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds and q.assessment_set.subject != ds:
                return None
        # A test_admin may only touch questions in sets THEY authored.
        if _hidden_from_test_admin(actor, q.assessment_set):
            return None
        return q

    def patch(self, request, pk: int):
        q = self._scoped_question_or_none(request, pk)
        if q is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        s = AssessmentQuestionAdminWriteSerializer(q, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        set_id = q.assessment_set_id
        q = s.save()
        _sync_question_to_bank(q)
        _demote_approved_set(
            set_id, request.user, reason="question_edited",
            correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
        )
        return Response(AssessmentQuestionAdminWriteSerializer(q).data)

    def delete(self, request, pk: int):
        q = self._scoped_question_or_none(request, pk)
        if q is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        # AssessmentAnswer.question is on_delete=PROTECT, so a question a student
        # has already answered can't be dropped by a bare delete() (it 500s). But
        # students attempt against a FROZEN AssessmentSetVersion snapshot and their
        # scores live on AssessmentResult (a stored aggregate) — neither references
        # the live question — so removing it and its per-question answer rows leaves
        # past attempts and grades intact. Mirror the set-delete contract: block by
        # default with a 409, and let the author pass ?force=true to remove the
        # question together with those answer records.
        force = str(request.query_params.get("force", "")).strip().lower() in (
            "1", "true", "yes", "on",
        )
        has_answers = q.answers.exists()
        if has_answers and not force:
            return Response(
                {
                    "detail": (
                        "This question has student answers. Force-delete to remove it "
                        "along with those answers (existing scores are not changed)."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        set_id = q.assessment_set_id
        try:
            with transaction.atomic():
                if has_answers:
                    q.answers.all().delete()
                q.delete()
                # Keep the set's question order dense (0..n-1) after removing a row,
                # under a set row-lock — same invariant the reorder endpoint holds.
                dense_compact_set_orders_locked(set_id)
        except ProtectedError:
            return Response(
                {
                    "detail": (
                        "This question is still referenced by protected records and "
                        "could not be deleted."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        _demote_approved_set(
            set_id, request.user, reason="question_deleted",
            correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminAssessmentSetReorderView(APIView):
    """
    POST /assessments/admin/sets/{set_pk}/questions/reorder/  {"ordered_ids": [...]}

    Atomically persist a full question ordering for a set. The whole set is
    reindexed to a dense, unique ``0..n-1`` under a set row-lock via a two-phase
    temp band — safe under the ``UNIQUE(assessment_set, order)`` constraint.
    Replaces the builder's old N-PATCH drag loop (which left duplicate/gapped
    orders if a request failed midway). Ids not listed are appended in canonical
    order; unknown ids are ignored.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def post(self, request, set_pk: int):
        aset = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=set_pk)
        if _hidden_from_test_admin(request.user, aset):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        raw = request.data.get("ordered_ids")
        if not isinstance(raw, list):
            return Response(
                {"detail": "ordered_ids must be a list of question ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ordered_ids = [int(x) for x in raw if isinstance(x, (int, str)) and str(x).isdigit()]
        final_ids = reorder_questions(aset.pk, ordered_ids)
        _demote_approved_set(
            aset.pk, request.user, reason="questions_reordered",
            correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
        )
        return Response({"ordered_ids": final_ids})


class AdminQuestionBankSelectView(APIView):
    """
    M4 — list APPROVED Question Bank questions for the builder's
    'Select From Question Bank' picker. Only status=APPROVED is ever returned;
    TRIAGE/IMPORTED/REJECTED/ARCHIVED questions are never selectable.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def get(self, request):
        from .domain.bank_integration import selectable_bank_questions

        qs = selectable_bank_questions(
            subject=request.query_params.get("subject") or None,
            domain_id=request.query_params.get("domain_id") or None,
            skill_id=request.query_params.get("skill_id") or None,
            difficulty=request.query_params.get("difficulty") or None,
            search=request.query_params.get("search") or None,
        )
        paginator = LimitOffsetPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        data = [
            {
                "id": q.id,
                "qb_id": q.qb_id,
                "subject": q.subject,
                "domain": q.domain.name if q.domain_id else None,
                "skill": q.skill.name if q.skill_id else None,
                "difficulty": q.difficulty,
                "question_type": q.question_type,
                "question_text": q.question_text,
                "current_version": q.current_version.version_number if q.current_version_id else None,
            }
            for q in page
        ]
        return paginator.get_paginated_response(data)


class AdminAssessmentQuestionFromBankView(APIView):
    """M4 — create an AssessmentQuestion sourced from an APPROVED bank question."""

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def post(self, request, set_pk: int):
        from django.core.exceptions import ValidationError as DjangoValidationError

        from questionbank.models import BankQuestion

        from .domain.bank_integration import create_question_from_bank

        aset = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=set_pk)
        if _hidden_from_test_admin(request.user, aset):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        bank = get_object_or_404(BankQuestion, pk=request.data.get("bank_question_id"))
        try:
            aq = create_question_from_bank(aset, bank)
        except DjangoValidationError as exc:
            msg = exc.messages[0] if getattr(exc, "messages", None) else str(exc)
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)
        return Response(AssessmentQuestionAdminWriteSerializer(aq).data, status=status.HTTP_201_CREATED)


def _import_questions_from_csv(request, aset):
    """Read the uploaded CSV, validate every row, and create the questions atomically.

    All-or-nothing: if any row is invalid, nothing is created and a per-row error list is
    returned so the author can fix the file. Returns ``(created_ids, error_response)`` — on
    success ``error_response`` is None; on failure ``created_ids`` is None.
    """
    upload = request.FILES.get("file")
    if upload is None:
        return None, Response({"detail": "Attach a CSV file in the 'file' field."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        text = decode_csv(upload.read())
    except UnicodeDecodeError:
        return None, Response({"detail": "Could not read the file — save it as UTF-8 CSV."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        payloads = parse_rows(text)
    except ValueError as exc:
        return None, Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    if not payloads:
        return None, Response({"detail": "The CSV has no question rows."}, status=status.HTTP_400_BAD_REQUEST)

    # Validate every row up front so a bad row never leaves a half-populated set.
    validated = []
    errors = []
    for offset, payload in enumerate(payloads):
        ser = AssessmentQuestionAdminWriteSerializer(data=payload)
        if ser.is_valid():
            validated.append(ser)
        else:
            errors.append({"row": offset + 2, "errors": ser.errors})  # +2: header is row 1
    if errors:
        return None, Response(
            {"detail": "Some rows are invalid; nothing was imported.", "errors": errors},
            status=status.HTTP_400_BAD_REQUEST,
        )

    created_ids = []
    with transaction.atomic():
        for ser in validated:
            q = create_question(aset, ser)
            created_ids.append(q.id)
            _sync_question_to_bank(q)
    _demote_approved_set(
        aset.pk, request.user, reason="csv_import",
        correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
    )
    return created_ids, None


class AdminAssessmentSetCsvImportView(APIView):
    """Create a NEW assessment set and populate it from an uploaded CSV of questions.

    Multipart body: the set-level fields (subject, source, level, category, title,
    description, is_active) plus a ``file`` CSV of question rows. All-or-nothing — if any
    row is invalid the set is not created either.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        denied = _deny_cross_subject(request, (request.data or {}).get("subject"))
        if denied:
            return denied
        set_ser = AssessmentSetAdminWriteSerializer(data=request.data)
        set_ser.is_valid(raise_exception=True)
        with transaction.atomic():
            aset = set_ser.save(created_by=request.user)
            created_ids, err = _import_questions_from_csv(request, aset)
            if err is not None:
                # Undo the set so a bad CSV leaves nothing behind.
                transaction.set_rollback(True)
                return err
        inst = AssessmentSet.objects.filter(pk=aset.pk).prefetch_related("questions").first()
        data = AssessmentSetSerializer(inst).data
        data["created_count"] = len(created_ids)
        return Response(data, status=status.HTTP_201_CREATED)


class AdminAssessmentSetQuestionsCsvImportView(APIView):
    """Append questions to an EXISTING set from an uploaded CSV. Multipart body: ``file``."""

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, set_pk: int):
        aset = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=set_pk)
        if _hidden_from_test_admin(request.user, aset):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        # Teacher subject scoping (defense-in-depth, mirrors the detail endpoints).
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds and aset.subject != ds:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        created_ids, err = _import_questions_from_csv(request, aset)
        if err is not None:
            return err
        return Response(
            {"set_id": aset.pk, "created_count": len(created_ids), "question_ids": created_ids},
            status=status.HTTP_201_CREATED,
        )


class AdminQuestionBankTaxonomyView(APIView):
    """
    M4 — domains & skills actually used by APPROVED bank questions, for the builder
    picker's filter dropdowns.

    Lives here (not in questionbank's own API) because the questionbank taxonomy
    endpoint is gated by CanManageQuestions (global staff only) and would 403 for
    teachers — who CAN author assessments and therefore use the picker.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def get(self, request):
        from questionbank.models import BankDomain, BankQuestion, BankSkill

        approved = BankQuestion.objects.approved()
        subject = request.query_params.get("subject") or None
        if subject:
            approved = approved.filter(subject=subject)
        domain_ids = list(approved.values_list("domain_id", flat=True).distinct())
        skill_ids = list(approved.values_list("skill_id", flat=True).distinct())
        domains = BankDomain.objects.filter(id__in=domain_ids).order_by(
            "subject", "display_order", "name"
        )
        skills = BankSkill.objects.filter(id__in=skill_ids).select_related("domain").order_by(
            "display_order", "name"
        )
        return Response(
            {
                "domains": [
                    {"id": d.id, "subject": d.subject, "name": d.name, "code": d.code}
                    for d in domains
                ],
                "skills": [
                    {
                        "id": s.id,
                        "domain": s.domain_id,
                        "subject": s.domain.subject,
                        "name": s.name,
                        "code": s.code,
                    }
                    for s in skills
                ],
            }
        )


class AdminPublishAssessmentSetView(APIView):
    """
    POST /assessments/admin/sets/{pk}/publish/

    Transition an AssessmentSet from DRAFT → PUBLISHED state by building an
    immutable AssessmentSetVersion snapshot.

    GOVERNANCE:
      - Enforces all publish preconditions (INV-001 through INV-003 from PublishService).
      - Idempotent: re-publishing identical content returns existing version (HTTP 200).
      - Creating a new version returns HTTP 201.
      - Concurrency-safe via select_for_update() inside publish_assessment_set().

    FRONTEND INTEGRATION:
      Currently the publish page calls PATCH is_active=true (legacy toggle).
      Sprint 5: swap publishSet() in builder/sets/[id]/publish/page.tsx to call this endpoint.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    @extend_schema(
        tags=["assessments"],
        summary="Publish assessment set (create immutable snapshot)",
        responses={
            200: AdminPublishResponseSerializer,
            201: AdminPublishResponseSerializer,
            400: ApiAssessmentDetailSerializer,
            404: ApiAssessmentDetailSerializer,
        },
    )
    def post(self, request, pk: int):
        from .domain.publish_service import publish_assessment_set, PublishValidationError

        # A test_admin may only publish sets they authored.
        _guard_set = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=pk)
        if _hidden_from_test_admin(request.user, _guard_set):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        # Determine whether a version already exists before publishing so we can
        # return the correct HTTP status (200 = idempotent / 201 = new version).
        existing_count = AssessmentSetVersion.objects.filter(assessment_set_id=pk).count()

        try:
            version = publish_assessment_set(set_id=pk, actor=request.user)
        except AssessmentSet.DoesNotExist:
            return Response({"detail": f"AssessmentSet #{pk} not found."}, status=status.HTTP_404_NOT_FOUND)
        except PublishValidationError as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)

        new_count = AssessmentSetVersion.objects.filter(assessment_set_id=pk).count()
        created = new_count > existing_count

        # When a NEW version was created (content changed), propagate it to this
        # set's not-yet-started homeworks so a teacher's edits reach assigned
        # classes — students already engaged (in_progress/submitted/graded) keep
        # their frozen snapshot.
        resynced = 0
        if created:
            try:
                from .domain.homework_versioning import resync_stale_homeworks
                resynced = resync_stale_homeworks(assessment_set=version.assessment_set, version=version)
            except Exception:
                import logging
                logging.getLogger(__name__).exception("resync_stale_homeworks failed for set %s", pk)

        data = {
            "version": AssessmentSetVersionSerializer(version).data,
            "created": created,
            "homeworks_resynced": resynced,
        }
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class AdminValidatePublishView(APIView):
    """
    GET /assessments/admin/sets/{pk}/validate-publish/

    Dry-run publish validation — returns the full validation report without
    creating a version or changing any state.

    Used by the builder pre-publish checklist page to surface blocking and
    warning findings before the user commits to publishing.

    Response shape:
        {
            "is_publishable": bool,
            "blocking_count": int,
            "warning_count": int,
            "findings": [
                {"severity": "blocking"|"warning", "code": str, "message": str,
                 "question_id": int|null, "context": dict},
                ...
            ]
        }
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanViewTests]

    @extend_schema(
        tags=["assessments"],
        summary="Dry-run publish validation (no state change)",
        responses={200: None, 404: ApiAssessmentDetailSerializer},
    )
    def get(self, request, pk: int):
        from .domain.publish_validator import validate_for_publish

        aset = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=pk)
        if _hidden_from_test_admin(request.user, aset):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        active_questions = list(
            AssessmentQuestion.objects.filter(
                assessment_set=aset, is_active=True
            ).order_by("order", "id")
        )
        report = validate_for_publish(aset, active_questions)
        return Response(report.to_dict())


class AdminAssessmentSetStatusView(APIView):
    """
    POST /assessments/admin/sets/{pk}/status/   body: {"status": "<target>"}

    Move a set through the review lifecycle draft → needs_review → approved.

      - submit for review (→ needs_review):  any author of the set.
      - send back        (→ draft):          any author or an approver.
      - re-open          (approved → needs_review): any author or an approver.
      - approve          (→ approved):       APPROVER ONLY (admin/super_admin). The
                          approval ALSO publishes an immutable version so an approved
                          set always has a snapshot to pin homeworks to; if the set
                          fails publish validation the status does NOT change and the
                          blocking findings are returned.

    Every transition emits a GovernanceEvent (INV-GE03).
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    # (current, target) pairs that are legal. same→same is treated as an idempotent no-op.
    _ALLOWED = {
        (AssessmentSet.STATUS_DRAFT, AssessmentSet.STATUS_NEEDS_REVIEW),
        (AssessmentSet.STATUS_NEEDS_REVIEW, AssessmentSet.STATUS_DRAFT),
        (AssessmentSet.STATUS_NEEDS_REVIEW, AssessmentSet.STATUS_APPROVED),
        (AssessmentSet.STATUS_DRAFT, AssessmentSet.STATUS_APPROVED),
        (AssessmentSet.STATUS_APPROVED, AssessmentSet.STATUS_NEEDS_REVIEW),
        (AssessmentSet.STATUS_APPROVED, AssessmentSet.STATUS_DRAFT),
    }
    _EVENT = {
        AssessmentSet.STATUS_NEEDS_REVIEW: GovernanceEvent.EVENT_SUBMIT_FOR_REVIEW,
        AssessmentSet.STATUS_APPROVED: GovernanceEvent.EVENT_APPROVE,
        AssessmentSet.STATUS_DRAFT: GovernanceEvent.EVENT_SEND_BACK,
    }

    @extend_schema(
        tags=["assessments"],
        summary="Transition an assessment set's review status",
        responses={200: AssessmentSetAdminSerializer, 400: ApiAssessmentDetailSerializer, 403: ApiAssessmentDetailSerializer},
    )
    def post(self, request, pk: int):
        from .domain.publish_service import publish_assessment_set, PublishValidationError

        target = (request.data.get("status") or "").strip()
        valid_targets = {c[0] for c in AssessmentSet.REVIEW_STATUS_CHOICES}
        if target not in valid_targets:
            return Response(
                {"detail": f"Invalid status. Expected one of {sorted(valid_targets)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        aset = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=pk)
        if _hidden_from_test_admin(request.user, aset):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        current = aset.review_status
        if current == target:
            return Response(AssessmentSetAdminSerializer(aset).data, status=status.HTTP_200_OK)

        if (current, target) not in self._ALLOWED:
            return Response(
                {"detail": f"Cannot move a set from '{current}' to '{target}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Approval is gated on the approver capability AND publishes a version.
        if target == AssessmentSet.STATUS_APPROVED:
            from access.services import can_approve_assessment

            if not can_approve_assessment(request.user):
                return Response(
                    {"detail": "Only an admin or super admin can approve a set."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            try:
                version = publish_assessment_set(set_id=pk, actor=request.user)
            except PublishValidationError as exc:
                return Response(
                    {
                        "detail": f"Cannot approve — the set is not publishable: {exc}",
                        "code": exc.code,
                        "findings": [f.to_dict() for f in exc.findings[:10]],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            with transaction.atomic():
                locked = AssessmentSet.objects.select_for_update().get(pk=pk)
                locked.review_status = AssessmentSet.STATUS_APPROVED
                locked.save(update_fields=["review_status", "updated_at"])
                emit_governance_event(
                    event_type=GovernanceEvent.EVENT_APPROVE,
                    actor=request.user,
                    entity_type="AssessmentSet",
                    entity_id=pk,
                    payload={"from": current, "version_id": version.pk, "version_number": version.version_number},
                    correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
                )
                aset = locked
            return Response(AssessmentSetAdminSerializer(aset).data, status=status.HTTP_200_OK)

        # Non-approval transitions: submit for review / send back.
        with transaction.atomic():
            locked = AssessmentSet.objects.select_for_update().get(pk=pk)
            locked.review_status = target
            locked.save(update_fields=["review_status", "updated_at"])
            emit_governance_event(
                event_type=self._EVENT[target],
                actor=request.user,
                entity_type="AssessmentSet",
                entity_id=pk,
                payload={"from": current, "to": target},
                correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
            )
            aset = locked
        return Response(AssessmentSetAdminSerializer(aset).data, status=status.HTTP_200_OK)


class AdminAssessmentSetVersionListView(APIView):
    """
    GET /assessments/admin/sets/{pk}/versions/

    List all published versions for an AssessmentSet, newest first.
    Used by the builder version history panel.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanViewTests]

    @extend_schema(
        tags=["assessments"],
        summary="List published versions for a set",
        responses={200: AssessmentSetVersionSerializer(many=True)},
    )
    def get(self, request, pk: int):
        aset = get_object_or_404(AssessmentSet.objects.select_related("created_by"), pk=pk)
        if _hidden_from_test_admin(request.user, aset):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        versions = AssessmentSetVersion.objects.filter(assessment_set=aset).select_related(
            "published_by"
        ).order_by("-version_number")
        return Response(AssessmentSetVersionSerializer(versions, many=True).data)
