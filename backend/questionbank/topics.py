"""A level's own topic list, managed by an admin from the builder.

The junior and foundation math midterms are tagged from the learning center's own topic
lists (``BankDomain`` rows with a ``level``; see migrations 0007 and 0008). Until now a new
topic needed a developer. These are the writes the builder's "+ New topic" and Topics page
make, and the rules they keep:

* only a level list is reachable — the SAT taxonomy the bank, assessments and every SAT
  report are built on is never touched from here;
* names are unique within a list the way the CSV importer reads them (``_norm_key``: case,
  spaces and apostrophes folded), so an import can never match two topics with one name;
* a topic's ``code`` is set once and never follows a rename, so a CSV that uses codes keeps
  working;
* a used topic is retired, never deleted: the questions tagged with it keep it and the
  results graded on it keep their frozen name. Only a topic nothing uses can be deleted.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.text import slugify

from access.services import is_global_scope_staff

from .models import BankDomain, BankSkill, TaxonomyLevel

logger = logging.getLogger(__name__)

NAME_MAX = 255


class TopicError(Exception):
    """A refused topic write. ``status`` is the HTTP status the view answers with."""

    def __init__(self, message: str, *, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def can_manage_topics(user) -> bool:
    """Global staff — admin, super_admin, test_admin, test_auditor and the Django superuser.

    Teachers pick topics on their questions but do not change the school's lists."""
    return is_global_scope_staff(user)


def level_lists():
    """Every level's own topic list (never the SAT taxonomy)."""
    return BankDomain.objects.exclude(level=TaxonomyLevel.SAT).order_by("subject", "level", "display_order", "id")


def level_topics():
    return BankSkill.objects.exclude(domain__level=TaxonomyLevel.SAT)


def _norm(value: str) -> str:
    # The CSV importer's own key, so "no two topics share a name" means what an import
    # needs it to mean. Imported lazily: exams depends on questionbank, not the reverse.
    from exams.question_csv_import import _norm_key

    return _norm_key(value)


def _clean_name(raw) -> str:
    name = " ".join(str(raw or "").split())
    if not name:
        raise TopicError("Type the topic's name.")
    if len(name) > NAME_MAX:
        raise TopicError(f"A topic name can be at most {NAME_MAX} characters.")
    return name


def _check_unique(domain: BankDomain, name: str, *, exclude_id: int | None = None) -> None:
    key = _norm(name)
    for other in domain.skills.all():
        if other.id == exclude_id:
            continue
        # The importer matches a row by name OR code, so a new name may not equal another
        # topic's code either.
        if key in (_norm(other.name), _norm(other.code)):
            if other.retired_at is not None:
                raise TopicError(
                    f"'{other.name}' is already in {domain.name}, retired. Restore it instead."
                )
            raise TopicError(f"'{other.name}' is already in {domain.name}.")


def _unique_code(domain: BankDomain, name: str) -> str:
    base = slugify(name)[:56] or "topic"
    taken = set(domain.skills.values_list("code", flat=True))
    code, n = base, 2
    while code in taken:
        code = f"{base}-{n}"
        n += 1
    return code


def uses(skill: BankSkill) -> dict[str, int]:
    """Everything that points at this topic. Any non-zero count makes it retire-only."""
    from exams.models import Question
    from midterms.models import MidtermQuestionResult

    from django.db.models import Q

    from .models import BankQuestion

    return {
        "questions": Question.objects.filter(skill=skill).count(),
        "results": MidtermQuestionResult.objects.filter(skill=skill).count(),
        # Never non-zero for a level topic (the bank is SAT-only), but a delete must not
        # find that out from a PROTECT error.
        "bank": BankQuestion.objects.filter(Q(skill=skill) | Q(suggested_skill=skill)).count(),
    }


def get_list(domain_id) -> BankDomain:
    domain = level_lists().filter(pk=domain_id).first()
    if domain is None:
        raise TopicError("No such topic list.", status=404)
    return domain


def get_topic(topic_id) -> BankSkill:
    skill = level_topics().select_related("domain").filter(pk=topic_id).first()
    if skill is None:
        raise TopicError("No such topic.", status=404)
    return skill


@transaction.atomic
def create_topic(domain: BankDomain, raw_name, *, actor=None) -> BankSkill:
    # The list row is the lock: two admins adding the same name at once take turns.
    domain = BankDomain.objects.select_for_update().get(pk=domain.pk)
    name = _clean_name(raw_name)
    _check_unique(domain, name)
    last = domain.skills.aggregate(m=Max("display_order"))["m"]
    skill = BankSkill.objects.create(
        domain=domain,
        name=name,
        code=_unique_code(domain, name),
        display_order=0 if last is None else last + 1,
    )
    logger.info("topic.create id=%s list=%s name=%r by=%s", skill.id, domain.code, name, getattr(actor, "id", None))
    return skill


@transaction.atomic
def update_topic(skill: BankSkill, *, name=None, retired=None, actor=None) -> BankSkill:
    domain = BankDomain.objects.select_for_update().get(pk=skill.domain_id)
    skill = BankSkill.objects.get(pk=skill.pk)
    fields = []
    if name is not None:
        clean = _clean_name(name)
        if clean != skill.name:
            _check_unique(domain, clean, exclude_id=skill.id)
            logger.info(
                "topic.rename id=%s %r -> %r by=%s", skill.id, skill.name, clean, getattr(actor, "id", None)
            )
            skill.name = clean
            fields.append("name")
    if retired is not None:
        if bool(retired) != (skill.retired_at is not None):
            skill.retired_at = timezone.now() if retired else None
            fields.append("retired_at")
            logger.info(
                "topic.%s id=%s name=%r by=%s",
                "retire" if retired else "restore", skill.id, skill.name, getattr(actor, "id", None),
            )
    if fields:
        skill.save(update_fields=fields)
    return skill


@transaction.atomic
def reorder_topics(domain: BankDomain, ids, *, actor=None) -> None:
    domain = BankDomain.objects.select_for_update().get(pk=domain.pk)
    if not isinstance(ids, (list, tuple)):
        raise TopicError("ids must be a list of topic ids.")
    try:
        wanted = [int(i) for i in ids]
    except (TypeError, ValueError):
        raise TopicError("ids must be a list of topic ids.")
    current = list(domain.skills.values_list("id", flat=True))
    if len(wanted) != len(set(wanted)) or set(wanted) != set(current):
        raise TopicError("Send every topic of this list exactly once.")
    order = {topic_id: i for i, topic_id in enumerate(wanted)}
    skills = list(domain.skills.all())
    for s in skills:
        s.display_order = order[s.id]
    BankSkill.objects.bulk_update(skills, ["display_order"])
    logger.info("topic.reorder list=%s by=%s", domain.code, getattr(actor, "id", None))


@transaction.atomic
def delete_topic(skill: BankSkill, *, actor=None) -> None:
    BankDomain.objects.select_for_update().get(pk=skill.domain_id)
    counts = uses(skill)
    used = sum(counts.values())
    if used:
        raise TopicError(
            f"'{skill.name}' is in use ({used}). Retire it instead: it leaves the picker and history keeps it.",
            status=409,
        )
    logger.info("topic.delete id=%s name=%r by=%s", skill.id, skill.name, getattr(actor, "id", None))
    skill.delete()
