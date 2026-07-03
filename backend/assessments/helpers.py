from __future__ import annotations

from .models import (
    AssessmentQuestion,
    AssessmentAttempt,
    AssessmentAttemptAuditEvent,
)


def _audit_attempt(attempt: AssessmentAttempt, *, actor, event_type: str, payload: dict | None = None) -> None:
    AssessmentAttemptAuditEvent.objects.create(
        attempt=attempt,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        event_type=event_type,
        payload=payload or {},
    )


# AssessmentQuestion image fields exposed to the runner/review (relative media URLs,
# matching AssessmentQuestionSerializer's output on the live path).


_QUESTION_IMAGE_FIELDS = (
    "question_image",
    "option_a_image",
    "option_b_image",
    "option_c_image",
    "option_d_image",
)


def _img_url(field) -> str | None:
    """Relative URL for an ImageField value, or None when no file is set."""
    if not field:
        return None
    try:
        return field.url
    except ValueError:
        return None


def _image_map_for(question_ids):
    """
    Resolve image URLs for a set of AssessmentQuestion ids → {id: {field: url}}.

    Snapshots don't pin images, so the frozen delivery/review paths supplement
    them from the live question rows. This is freeze-safe: django-cleanup is
    absent, so published image files are never deleted. Text/choices/correct
    answers still come from the snapshot, preserving the freeze guarantee.
    """
    rows = AssessmentQuestion.objects.filter(id__in=list(question_ids)).only(
        "id", *_QUESTION_IMAGE_FIELDS
    )
    return {
        q.id: {f: _img_url(getattr(q, f)) for f in _QUESTION_IMAGE_FIELDS}
        for q in rows
    }


def _serialize_feedback(fb) -> dict | None:
    """Serialize an AssessmentAttemptFeedback for student/teacher consumption."""
    if fb is None:
        return None
    return {
        "body": fb.body,
        "teacher_name": fb.teacher.get_full_name() or fb.teacher.email if fb.teacher else None,
        "updated_at": fb.updated_at.isoformat(),
    }


def _build_hw_meta(hw) -> dict:
    """
    Build the `meta` block returned to students alongside their attempt/result.

    Includes human-readable assignment context (title, set name, due date,
    question count) so the frontend can display meaningful context without
    making extra API calls.  Never includes correct_answer or grading_config.
    """
    aset = hw.assessment_set
    assignment = hw.assignment
    active_q_count = aset.questions.filter(is_active=True).count() if aset else 0
    return {
        "assignment_id": assignment.pk if assignment else None,
        "assignment_title": assignment.title if assignment else None,
        "set_title": aset.title if aset else None,
        "set_category": aset.category if aset else None,
        # Read-only exposure of the existing AssessmentSet.subject so the student
        # analytics page can group SAT strands by section. No logic/DB change.
        "set_subject": aset.subject if aset else None,
        "due_at": assignment.due_at.isoformat() if assignment and assignment.due_at else None,
        "question_count": active_q_count,
        "classroom_name": hw.classroom.name if hw.classroom else None,
    }


def _summarise_governance_payload(payload: dict) -> dict:
    """
    Return a safe subset of a governance event payload for the ops audit UI.
    Strips any key that looks like it could contain grading internals.
    """
    safe_keys = {
        "set_id", "set_title", "version_number", "question_count",
        "checksum", "previous_version_id", "warning_count", "blocking_count",
        "first_code", "reason", "source", "snapshot_pinned",
        "superseded_by_version_id", "superseded_by_version_number",
        "pinned_version_id", "pinned_version_number", "description",
    }
    return {k: v for k, v in (payload or {}).items() if k in safe_keys}
