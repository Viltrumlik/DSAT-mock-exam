"""The builder's topic-list API: a level's own midterm topics, managed by an admin.

    GET    /api/questionbank/topic-lists/                    every level list + its topics
    POST   /api/questionbank/topic-lists/<id>/topics/        {name}            add a topic
    POST   /api/questionbank/topic-lists/<id>/reorder/       {ids: [...]}      reorder a list
    PATCH  /api/questionbank/topics/<id>/                    {name?, retired?} rename / retire / restore
    DELETE /api/questionbank/topics/<id>/                    only when nothing uses it

Global staff only (``topics.can_manage_topics``). The SAT taxonomy is never reachable here:
an SAT domain or skill id answers 404. The rules live in ``topics.py``.
"""

from __future__ import annotations

from django.db.models import Count
from drf_spectacular.utils import extend_schema
from rest_framework import status as http_status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import IsAuthenticatedAndNotFrozen

from . import topics
from .models import BankSkill


class CanManageTopicLists(BasePermission):
    message = "Only admins manage topic lists."

    def has_permission(self, request, view):
        return topics.can_manage_topics(request.user)


PERMISSIONS = [IsAuthenticatedAndNotFrozen, CanManageTopicLists]


def _topic_row(skill: BankSkill, *, questions: int = 0, graded: int = 0) -> dict:
    return {
        "id": skill.id,
        "name": skill.name,
        "code": skill.code,
        "order": skill.display_order,
        "retired": skill.retired_at is not None,
        # Questions tagged with it now, and graded midterm answers frozen on it. Either one
        # non-zero means the topic can be retired but not deleted.
        "questions": questions,
        "graded": graded,
    }


def _error(exc: topics.TopicError) -> Response:
    return Response({"detail": exc.message}, status=exc.status)


@extend_schema(tags=["questionbank"])
class TopicListsView(APIView):
    permission_classes = PERMISSIONS

    def get(self, request):
        from midterms.models import MidtermQuestionResult

        lists = list(topics.level_lists())
        skills = list(
            BankSkill.objects.filter(domain__in=lists)
            .annotate(n_questions=Count("exam_questions", distinct=True))
            .order_by("display_order", "name")
        )
        graded = dict(
            MidtermQuestionResult.objects.filter(skill_id__in=[s.id for s in skills])
            .values("skill_id")
            .annotate(n=Count("id"))
            .values_list("skill_id", "n")
        )
        by_list: dict[int, list] = {d.id: [] for d in lists}
        for s in skills:
            by_list[s.domain_id].append(_topic_row(s, questions=s.n_questions, graded=graded.get(s.id, 0)))
        return Response({
            "results": [
                {
                    "id": d.id,
                    "name": d.name,
                    "subject": d.subject,
                    "level": d.level,
                    "level_label": d.get_level_display(),
                    "topics": by_list[d.id],
                }
                for d in lists
            ]
        })


@extend_schema(tags=["questionbank"])
class TopicCreateView(APIView):
    permission_classes = PERMISSIONS

    def post(self, request, pk):
        try:
            skill = topics.create_topic(topics.get_list(pk), request.data.get("name"), actor=request.user)
        except topics.TopicError as exc:
            return _error(exc)
        return Response(_topic_row(skill), status=http_status.HTTP_201_CREATED)


@extend_schema(tags=["questionbank"])
class TopicReorderView(APIView):
    permission_classes = PERMISSIONS

    def post(self, request, pk):
        try:
            topics.reorder_topics(topics.get_list(pk), request.data.get("ids"), actor=request.user)
        except topics.TopicError as exc:
            return _error(exc)
        return Response(status=http_status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["questionbank"])
class TopicDetailView(APIView):
    permission_classes = PERMISSIONS

    def patch(self, request, pk):
        retired = request.data.get("retired")
        if retired is not None and not isinstance(retired, bool):
            return Response({"detail": "retired must be true or false."}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            skill = topics.update_topic(
                topics.get_topic(pk), name=request.data.get("name"), retired=retired, actor=request.user,
            )
        except topics.TopicError as exc:
            return _error(exc)
        counts = topics.uses(skill)
        return Response(_topic_row(skill, questions=counts["questions"], graded=counts["results"]))

    def delete(self, request, pk):
        try:
            topics.delete_topic(topics.get_topic(pk), actor=request.user)
        except topics.TopicError as exc:
            return _error(exc)
        return Response(status=http_status.HTTP_204_NO_CONTENT)
