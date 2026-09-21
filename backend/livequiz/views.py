"""REST for everything that is not the game itself.

Creating a room, finding one by code, and reading results afterwards are ordinary requests
and belong on the ordinary API. The socket carries only what has to arrive the instant it
happens.

Joining is deliberately here rather than on the socket. The code is checked once, over
HTTPS, and exchanged for a session id; the socket then authenticates the person and never
sees the code. That keeps the code out of URLs, out of access logs and out of the browser's
history.
"""

from __future__ import annotations

from django.conf import settings
from django.db.models import Count, Q
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from assessments.models import AssessmentSet
from classes.capabilities import classroom_capabilities
from classes.models import Classroom, ClassroomMembership
from core.errors.api import Forbidden, NotFound

from . import constants as const
from . import services
from .models import LiveQuizSession
from .serializers import CreateSessionSerializer, JoinSerializer, session_summary


def _require_enabled() -> None:
    """Off means invisible. A 404 rather than a 503: there is no feature to retry."""
    if not bool(getattr(settings, "LIVE_QUIZ_ENABLED", False)):
        raise NotFound("Live quizzes are not switched on.", code="feature_off")


def _counts(session) -> dict:
    return {
        "participants": session.participants.filter(status=const.PARTICIPANT_JOINED).count(),
        "present": session.participants.filter(
            status=const.PARTICIPANT_JOINED, connections__gt=0
        ).count(),
    }


def _summary(session) -> dict:
    return session_summary(
        session, question_total=services.question_count(session), counts=_counts(session)
    )


def _load_for_host(pk, user) -> LiveQuizSession:
    session = (
        LiveQuizSession.objects.select_related("classroom", "assessment_set").filter(pk=pk).first()
    )
    if session is None:
        raise NotFound("No such live quiz.", code="not_found")
    if not classroom_capabilities(user, session.classroom).is_staff:
        raise Forbidden("You do not teach this class.", code="not_class_staff")
    return session


class SessionListCreateView(APIView):
    """GET: the rooms I host. POST: mint a new one."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require_enabled()
        queryset = LiveQuizSession.objects.select_related("classroom", "assessment_set")

        classroom_id = request.query_params.get("classroom")
        if classroom_id:
            queryset = queryset.filter(classroom_id=classroom_id)

        # Staff see every room in the classes they teach, not only the ones they opened —
        # a covering teacher has to be able to pick up a colleague's game.
        staff_classroom_ids = (
            ClassroomMembership.objects.filter(
                user=request.user, role__in=list(ClassroomMembership.STAFF_ROLES)
            )
            .exclude(status=ClassroomMembership.STATUS_REMOVED)
            .values_list("classroom_id", flat=True)
        )

        queryset = queryset.filter(
            Q(classroom_id__in=list(staff_classroom_ids)) | Q(host=request.user)
        )

        if str(request.query_params.get("live") or "").lower() in ("1", "true", "yes"):
            queryset = queryset.filter(status__in=list(const.LIVE_STATUSES))

        return Response({"results": [_summary(s) for s in queryset[:100]]})

    def post(self, request):
        _require_enabled()
        payload = CreateSessionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        classroom = Classroom.objects.filter(pk=data["classroom_id"]).first()
        if classroom is None:
            raise NotFound("No such class.", code="classroom_not_found")

        assessment_set = AssessmentSet.objects.filter(pk=data["assessment_set_id"]).first()
        if assessment_set is None:
            raise NotFound("No such quiz.", code="set_not_found")

        session = services.create_session(
            host=request.user,
            classroom=classroom,
            assessment_set=assessment_set,
            config=data.get("config") or {},
        )
        return Response(_summary(session), status=201)


class SessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _require_enabled()
        session = _load_for_host(pk, request.user)
        return Response(_summary(session))


class SessionTerminateView(APIView):
    """Stop a room for good. Hosts only, and it cannot be undone."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        _require_enabled()
        session = _load_for_host(pk, request.user)
        return Response(_summary(services.terminate_session(session=session)))


class SessionResultsView(APIView):
    """The full table after the game. Staff see everyone; a student sees only their own row."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _require_enabled()
        session = (
            LiveQuizSession.objects.select_related("classroom", "assessment_set")
            .filter(pk=pk)
            .first()
        )
        if session is None:
            raise NotFound("No such live quiz.", code="not_found")

        role = services.role_in_session(request.user, session)
        if role is None:
            raise Forbidden("This live quiz belongs to a class you are not in.", code="not_in_class")

        report = services.results_report(session)
        if role != services.ROLE_HOST:
            # A student keeps the per-question stats — how the class did on each one is the
            # useful part of a post-mortem, and it names nobody — but only their own row.
            report["participants"] = [
                row for row in report["participants"] if row["user_id"] == request.user.pk
            ]
        return Response({"session": _summary(session), "report": report})


class JoinView(APIView):
    """Type a code, get a place. The only endpoint that takes a code."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        _require_enabled()
        payload = JoinSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        session = services.find_session_by_code(payload.validated_data["code"])
        if session is None:
            # Deliberately the same answer for "no such code" and "that game is over": a
            # wrong code should not confirm which codes exist.
            raise NotFound("That code does not match a live quiz.", code="bad_code")

        participant = services.join_session(session=session, user=request.user)
        return Response(
            {
                "session": _summary(session),
                "participant": {
                    "id": participant.id,
                    "display_name": participant.display_name,
                    "score": participant.score,
                },
            }
        )


class MyLiveSessionsView(APIView):
    """Games running right now in the classes I am in — so a student need not type a code."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require_enabled()
        classroom_ids = (
            ClassroomMembership.objects.filter(
                user=request.user, role=ClassroomMembership.ROLE_STUDENT
            )
            .exclude(status=ClassroomMembership.STATUS_REMOVED)
            .values_list("classroom_id", flat=True)
        )
        sessions = (
            LiveQuizSession.objects.select_related("classroom", "assessment_set")
            .filter(classroom_id__in=list(classroom_ids), status__in=list(const.LIVE_STATUSES))
            .order_by("-created_at")[:20]
        )
        rows = []
        for session in sessions:
            row = _summary(session)
            # The code is not needed to join from this list, and a student who can see a
            # list of live codes can hand them to somebody outside the class.
            row.pop("join_code", None)
            rows.append(row)
        return Response({"results": rows})


class HostOptionsView(APIView):
    """What this class can be given: the same set list the homework builder offers."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require_enabled()
        classroom = Classroom.objects.filter(pk=request.query_params.get("classroom")).first()
        if classroom is None:
            raise NotFound("No such class.", code="classroom_not_found")
        if not classroom_capabilities(request.user, classroom).is_staff:
            raise Forbidden("You do not teach this class.", code="not_class_staff")

        queryset = AssessmentSet.objects.filter(is_active=True)
        if classroom.domain_subject:
            queryset = queryset.filter(subject=classroom.domain_subject)
        # Level-scoped exactly as the homework picker is: a Middle class is offered Middle
        # sets. An untagged class keeps seeing everything.
        if classroom.level:
            queryset = queryset.filter(level=classroom.level)

        queryset = queryset.annotate(
            question_total=Count("questions", filter=Q(questions__is_active=True))
        ).order_by("-created_at")

        return Response(
            {
                "classroom": {"id": classroom.id, "name": classroom.name, "level": classroom.level},
                "assessment_sets": [
                    {
                        "id": row.id,
                        "title": row.title,
                        "subject": row.subject,
                        "level": row.level or "",
                        "category": row.category or "",
                        "question_count": row.question_total,
                        "review_status": row.review_status,
                        "is_approved": row.review_status == AssessmentSet.STATUS_APPROVED,
                    }
                    for row in queryset[:200]
                    if row.question_total > 0
                ],
            }
        )
