"""Serializers for invigilated mock sittings — one shape for staff, a narrower one for students."""

from __future__ import annotations

from rest_framework import serializers

from .models import MockSession, MockSessionParticipant


def _person(user) -> dict:
    if user is None:
        return {}
    name = " ".join(x for x in [user.first_name, user.last_name] if x).strip()
    return {"id": user.id, "name": name or user.username, "username": user.username}


class MockSessionParticipantSerializer(serializers.ModelSerializer):
    """One row of the teacher's approval queue."""

    student_details = serializers.SerializerMethodField()
    attempt_state = serializers.SerializerMethodField()

    class Meta:
        model = MockSessionParticipant
        fields = [
            "id", "status", "requested_at", "decided_at",
            "student", "student_details", "attempt", "attempt_state",
        ]
        read_only_fields = fields

    def get_student_details(self, obj):
        return _person(obj.student)

    def get_attempt_state(self, obj):
        """What the paper is doing right now — the console's live column."""
        att = obj.attempt
        if att is None:
            return ""
        if att.terminated_reason:
            return f"TERMINATED:{att.terminated_reason}"
        return att.current_state


class MockSessionSerializer(serializers.ModelSerializer):
    """Staff view: everything, including the code."""

    mock_title = serializers.CharField(source="mock.title", read_only=True)
    created_by_details = serializers.SerializerMethodField()
    counts = serializers.SerializerMethodField()
    accepts_requests = serializers.SerializerMethodField()

    class Meta:
        model = MockSession
        fields = [
            "id", "mock", "mock_title", "title", "session_date", "status",
            "access_code", "access_code_set_at", "classroom",
            "started_at", "ended_at", "created_at",
            "created_by", "created_by_details", "counts", "accepts_requests",
        ]
        read_only_fields = [
            "status", "access_code", "access_code_set_at", "started_at", "ended_at",
            "created_at", "created_by", "created_by_details", "counts", "accepts_requests",
            "mock_title",
        ]

    def get_created_by_details(self, obj):
        return _person(obj.created_by)

    def get_accepts_requests(self, obj):
        return obj.accepts_requests()

    def get_counts(self, obj):
        rows = list(obj.participants.all())
        return {
            "pending": sum(1 for p in rows if p.status == MockSessionParticipant.STATUS_PENDING),
            "approved": sum(1 for p in rows if p.status == MockSessionParticipant.STATUS_APPROVED),
            "rejected": sum(1 for p in rows if p.status == MockSessionParticipant.STATUS_REJECTED),
            "seated": sum(1 for p in rows if p.attempt_id is not None),
        }


class StudentMockSessionSerializer(serializers.Serializer):
    """Student view: their own place, and NEVER the access code.

    The code is a door key: a student who already holds a place has no reason to be handed
    it again, and serialising it would let anyone with one approved place pass it around.
    """

    def to_representation(self, place: MockSessionParticipant):
        session = place.session
        attempt_id = place.attempt_id
        return {
            "session_id": session.id,
            "mock_id": session.mock_id,
            "title": session.display_title,
            "session_date": session.session_date.isoformat(),
            "status": session.status,
            "my_status": place.status,
            "requested_at": place.requested_at.isoformat() if place.requested_at else None,
            # The one field the waiting room polls for: non-null the instant the room starts.
            "attempt_id": attempt_id if place.status == MockSessionParticipant.STATUS_APPROVED else None,
            "started_at": session.started_at.isoformat() if session.started_at else None,
        }
