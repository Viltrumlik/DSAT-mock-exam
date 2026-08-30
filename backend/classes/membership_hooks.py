"""Record every membership change, whichever code path made it.

Signals rather than calls edited into each view, for the reason ``rewards.hooks`` gives about
attendance: the write paths are plural and easy to miss. ``ClassroomMembership`` is written
by the roster PATCH, the code-less add, the join-code flow, the leave endpoint, the
support-teacher unassign, the Django admin, and any management command anybody writes next
year. Hanging off the model catches all of them without asking a future caller to remember.

**``pre_save`` reads the old row; ``post_save`` writes the event.** The previous values are
only knowable before the UPDATE lands, and the event must only be written after it has —
otherwise a save that fails its constraint would still leave an audit row claiming it
happened. So the old state is stashed on the instance in ``pre_save`` and read back in
``post_save``. Stashing on the instance rather than in a dict keyed by pk matters: an
unsaved instance has no pk.

**A no-op save writes nothing.** ``membership.save()`` with nothing changed is common — the
roster view saves after deciding not to change anything, and several flows re-save to touch
``updated_at``. An audit table that records those is one nobody will read.

Every receiver is wrapped: an audit failure must never break the thing it is recording.
Losing one row of history is bad; refusing a teacher's roster change because the history
table was busy is worse.
"""

from __future__ import annotations

import logging

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from django.contrib.auth import get_user_model

from core.actor import get_actor

logger = logging.getLogger(__name__)

#: Where pre_save parks the old row for post_save. Prefixed because it rides on a model
#: instance that other code also touches.
_SNAPSHOT_ATTR = "_membership_audit_previous"

#: Repeated here rather than imported from the model, because this module is loaded from app
#: config and a model import at module scope is a load-order cycle. The model's own
#: ACTION_CHOICES remain the definition; a test asserts the two agree.
ADDED = "ADDED"
REMOVED = "REMOVED"
REINSTATED = "REINSTATED"
ROLE_CHANGED = "ROLE_CHANGED"
STATUS_CHANGED = "STATUS_CHANGED"
DELETED = "DELETED"


def _name(user) -> str:
    if user is None:
        return ""
    full = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
    return (full or getattr(user, "username", "") or getattr(user, "email", "") or str(user.pk))[:200]


def _classify(previous, instance) -> tuple[str, str]:
    """``(action, note)`` for one change. ``previous`` is None for a brand-new membership."""
    from .models import ClassroomMembership

    if previous is None:
        return ADDED, ""

    old_status, new_status = previous["status"], instance.status
    old_role, new_role = previous["role"], instance.role

    if old_status != new_status:
        if new_status == ClassroomMembership.STATUS_REMOVED:
            return REMOVED, ""
        if old_status == ClassroomMembership.STATUS_REMOVED:
            return REINSTATED, ""
        return STATUS_CHANGED, ""
    if old_role != new_role:
        return ROLE_CHANGED, ""
    return "", ""


def _dies_with(origin, model_name: str, pk) -> bool:
    """Is ``origin`` the delete of the very row this event would point at?

    ``origin`` is what the collector was asked to delete: a model instance, or a QuerySet on
    a bulk delete. Both shapes have to be recognised.
    """
    if origin is None:
        return False
    if origin.__class__.__name__ == model_name and getattr(origin, "pk", None) == pk:
        return True
    model = getattr(origin, "model", None)
    return model is not None and model.__name__ == model_name


def _write(instance, action: str, previous: dict | None, *, note: str = "",
           keep_classroom_fk: bool = True) -> None:
    from .models_membership_audit import ClassroomMembershipEvent

    actor = get_actor()
    classroom = getattr(instance, "classroom", None)
    student = getattr(instance, "user", None)
    # The name is copied either way, so the row still reads properly with a null FK.
    classroom_name = (getattr(classroom, "name", "") or "")[:200]
    ClassroomMembershipEvent.objects.create(
        classroom=classroom if keep_classroom_fk else None,
        classroom_name=classroom_name,
        student=student,
        student_name=_name(student),
        actor=actor,
        actor_name=_name(actor),
        action=action,
        previous_role=(previous or {}).get("role", "") or "",
        new_role=instance.role or "",
        previous_status=(previous or {}).get("status", "") or "",
        new_status=instance.status or "",
        note=note[:240],
    )


@receiver(pre_save, sender="classes.ClassroomMembership", dispatch_uid="membership_audit_pre")
def _stash_previous(sender, instance, **kwargs):
    """Read the row as it stands, before the UPDATE overwrites it."""
    try:
        if instance.pk is None:
            instance.__dict__[_SNAPSHOT_ATTR] = None
            return
        previous = sender.objects.filter(pk=instance.pk).values("role", "status").first()
        instance.__dict__[_SNAPSHOT_ATTR] = previous
    except Exception:
        # Losing the previous state costs detail, not the event: post_save still records
        # that something changed. Never let this raise into the save.
        logger.exception("membership_audit_pre_failed pk=%s", getattr(instance, "pk", None))
        instance.__dict__[_SNAPSHOT_ATTR] = None


@receiver(post_save, sender="classes.ClassroomMembership", dispatch_uid="membership_audit_post")
def _record_change(sender, instance, created, **kwargs):
    try:
        previous = instance.__dict__.pop(_SNAPSHOT_ATTR, None)
        if created:
            _write(instance, ADDED, None)
            return
        action, note = _classify(previous, instance)
        if not action:
            # Nothing that belongs in a history changed. See the module docstring.
            return
        _write(instance, action, previous, note=note)
    except Exception:
        logger.exception("membership_audit_post_failed pk=%s", getattr(instance, "pk", None))


@receiver(post_delete, sender="classes.ClassroomMembership", dispatch_uid="membership_audit_delete")
def _record_delete(sender, instance, origin=None, **kwargs):
    """A membership ROW was destroyed, which is not the same as a student being removed.

    Removal is a soft delete that leaves the row and can be undone; this cannot. Worth its own
    action so the two never read as the same event.

    Skipped when the student themselves is being deleted: the whole cascade is going, the
    ``student`` FK would be nulled by the same statement, and the row would be an event about
    nobody. The classroom cascading is different and IS recorded — the class is gone but the
    people are not, and "what happened to my membership of that class" stays a real question.

    **But that event must not carry the classroom FK.** Under a classroom cascade the
    collector has already applied its SET_NULL updates by the time ``post_delete`` fires, so a
    row written here pointing at the classroom references an id that is about to vanish — and
    on a database that enforces it, the whole delete fails at COMMIT. The name is copied in
    regardless, so the event still reads as what it is.
    """
    try:
        if _dies_with(origin, get_user_model().__name__, getattr(instance, "user_id", None)):
            return
        classroom_going = _dies_with(origin, "Classroom", getattr(instance, "classroom_id", None))
        _write(
            instance, DELETED, {"role": instance.role, "status": instance.status},
            keep_classroom_fk=not classroom_going,
        )
    except Exception:
        logger.exception("membership_audit_delete_failed pk=%s", getattr(instance, "pk", None))
