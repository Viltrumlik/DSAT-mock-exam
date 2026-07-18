"""How much work an account actually holds.

Used by the ops console to answer "which of these two same-name rows is the real
person" — and, more importantly, to warn before a delete: every one of these
relations is ``on_delete=CASCADE``, so removing a user destroys their entire exam
history with no undo.

Leaf module: no DRF, no views. Imported by both the serializer and the list view.
"""
from __future__ import annotations

from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce

# (app_label, model_name, FK field name) for every relation that represents graded or
# submitted work. Deliberately excludes sessions, audit events and access grants —
# those accumulate without the user doing anything and would make an idle duplicate
# look active.
ACTIVITY_RELATIONS = (
    ("exams", "TestAttempt", "student"),
    ("classes", "Submission", "student"),
    ("assessments", "AssessmentAttempt", "student"),
    ("midterms", "MidtermAttempt", "student"),
    ("mocks", "MockAttempt", "student"),
)


def _models():
    from django.apps import apps

    for app_label, model_name, field in ACTIVITY_RELATIONS:
        yield apps.get_model(app_label, model_name), field


def _count_subquery(model, field: str):
    """Correlated COUNT for one relation.

    A subquery per relation rather than five LEFT JOINs with ``Count(distinct=True)``:
    joining all five multiplies rows before the aggregate, and a heavy account (prod has
    one with 3,761 rows) would blow up into a large intermediate result.
    """
    return Coalesce(
        Subquery(
            model.objects.filter(**{field: OuterRef("pk")})
            .order_by()
            .values(field)
            .annotate(n=Count("pk"))
            .values("n")[:1],
            output_field=IntegerField(),
        ),
        Value(0),
        output_field=IntegerField(),
    )


def with_activity_counts(queryset):
    """Annotate ``attempt_count`` — total graded/submitted rows across all relations."""
    total = None
    for model, field in _models():
        part = _count_subquery(model, field)
        total = part if total is None else total + part
    return queryset.annotate(attempt_count=total)


def activity_count(user) -> int:
    """Same number for a single user, without the annotation. Prefer the annotation."""
    return sum(model.objects.filter(**{field: user}).count() for model, field in _models())


def has_activity(user) -> bool:
    """Short-circuiting variant: does this account hold any work at all?

    Used by the email-release gate, where the question is only ever "any or none" and
    counting a heavy account would be wasted work.
    """
    return any(model.objects.filter(**{field: user}).exists() for model, field in _models())


def blocking_protected_relations(user) -> list[str]:
    """Human-readable relations that would make a hard delete fail with ProtectedError.

    ``UserBulkActionView`` catches a bare ``Exception`` and reports "operation failed",
    which tells staff nothing. Call this to say *which* relation is holding the row.
    """
    blocking: list[str] = []
    for field in user._meta.related_objects:
        on_delete = getattr(field.remote_field, "on_delete", None)
        if on_delete is None or getattr(on_delete, "__name__", "") != "PROTECT":
            continue
        model = field.related_model
        if model.objects.filter(**{field.field.name: user}).exists():
            blocking.append(f"{model._meta.verbose_name_plural}")
    return blocking


__all__ = [
    "ACTIVITY_RELATIONS",
    "activity_count",
    "blocking_protected_relations",
    "has_activity",
    "with_activity_counts",
]
