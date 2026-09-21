"""Input validation and the REST output shapes.

Output is built by hand here rather than with ModelSerializer for one reason: a live quiz
row holds the answer key, and a serializer that lists fields is one `fields = "__all__"`
away from posting it to the class. Everything below names what it sends.
"""

from __future__ import annotations

from rest_framework import serializers

from . import constants as const


class CreateSessionSerializer(serializers.Serializer):
    classroom_id = serializers.IntegerField()
    assessment_set_id = serializers.IntegerField()
    config = serializers.DictField(required=False, default=dict)


class JoinSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=16)


def session_summary(session, *, question_total: int | None = None, counts: dict | None = None) -> dict:
    """One room, as a list row or a detail page. No questions, no key."""
    return {
        "id": session.id,
        "join_code": session.join_code,
        "status": session.status,
        "classroom_id": session.classroom_id,
        "classroom_name": getattr(session.classroom, "name", ""),
        "assessment_set_id": session.assessment_set_id,
        "title": getattr(session.assessment_set, "title", ""),
        "host_id": session.host_id,
        "current_index": session.current_index,
        "question_total": question_total,
        "config": {key: session.setting(key) for key in const.CONFIG_KEYS},
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "finished_at": session.finished_at.isoformat() if session.finished_at else None,
        "counts": counts or {},
    }
