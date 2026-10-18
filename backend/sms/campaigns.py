"""Manual sends ("jo'natma") from /ops/sms: one approved template to some students, a class or every
debtor — now, or at a set time.

**Who gets one is decided when it goes out**, not when it is written: ``send_campaign`` resolves the
audience again, so a debtor who paid after a campaign was scheduled is skipped. The phone is always
the one lc-up holds (``LcupStudentLink.phone``) — no number is ever typed in — and a person with no
link or no phone is skipped and listed, never guessed at.

**Never twice.** ``dispatch_due`` claims a campaign SCHEDULED → SENDING in one UPDATE, so two beats
(or the beat and the "now" task) cannot both send it. Every SMS then goes through
``delivery.deliver`` under ``campaign:<id>:student:<lc-up id>`` on the campaign's own day (the day
it was scheduled for) with all its guarantees: UNCERTAIN (it may have left) is never sent again,
FAILED (it never left) may be. So ``send_campaign`` can always run again on the same campaign —
whatever already left is skipped — and three things do run it again:

* **the reaper** (``resume_stuck``, every minute): a worker killed mid-send leaves its campaign
  SENDING; one whose heartbeat (``started_at``, bumped every HEARTBEAT_EVERY recipients) is older
  than STUCK_AFTER is claimed again in one UPDATE and finished;
* **the circuit breaker**: BREAKER_AFTER failed or uncertain sends in a row stop the campaign
  (FAILED) with the rest unclaimed — eskiz is down, and 300 failures help nobody;
* **Retry** (``retry`` + ``resume``): a DONE or FAILED campaign is claimed SENDING again and sent
  as a resume — the recipients worked out anew, FAILED ones re-claimed, the unreached sent.

**At most LIMIT recipients**, checked at the preview, at create and again at send: a class or the
debtor list can grow between the two, and a campaign that grew past it sends nothing.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from lcup.models import LcupStudentLink
from lcup.phones import normalize_phone
from users.models import User

from . import switchboard
from . import templates as T
from .debt_warnings import STALE_AFTER
from .delivery import deliver
from .models import EskizTemplate, SmsCampaign, SmsMessage

logger = logging.getLogger("sms.campaigns")

#: The most SMS one campaign may send (owner, 2026-10-18).
LIMIT = 300
#: A "send at" a little in the past (the time it took to click Confirm) still means now.
PAST_GRACE = timedelta(minutes=1)
SAMPLES = 3
SKIP_REASONS = ("no_link", "no_phone", "stale_balance", "not_debtor", "bad_text")
#: A send bumps its campaign's ``started_at`` at least this often (recipients): the reaper's heartbeat.
HEARTBEAT_EVERY = 20
#: A SENDING campaign whose heartbeat is older than this lost its worker. One eskiz request is at most
#: ~25 s (eskiz.TIMEOUT), so a live send bumps it every ~8 min at worst.
STUCK_AFTER = timedelta(minutes=15)
#: This many FAILED or UNCERTAIN sends in a row stop a campaign: eskiz is down or refusing us.
BREAKER_AFTER = 5
_BROKEN = frozenset({SmsMessage.STATUS_FAILED, SmsMessage.STATUS_UNCERTAIN})
#: What Retry may pick up again: finished, or stopped (the breaker, the limit).
RETRYABLE = (SmsCampaign.STATUS_DONE, SmsCampaign.STATUS_FAILED)
#: Siblings on a parent's phone whose texts come out the same get one SMS between them.
SAME_PHONE = "same_phone"
_DIGITS = re.compile(r"^[0-9]+$")
#: What eskiz took: the SMS left, whatever became of it.
_ACCEPTED = frozenset({SmsMessage.STATUS_SENT, SmsMessage.STATUS_DELIVERED, SmsMessage.STATUS_UNDELIVERED})
EMPTY_RESULT = {"sent": 0, "failed": 0, "rejected": 0, "uncertain": 0, "errors": 0, "skipped": {}}


class CampaignRefused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Draft:
    """A campaign as typed, checked by ``clean``: what ``preview`` and ``create`` work from. It reads
    like an ``SmsCampaign``, so ``resolve`` and ``render_for`` take either."""

    template_id: int
    pattern: str
    original: str
    slot_roles: tuple
    slot_texts: tuple
    audience: str
    audience_ids: tuple
    #: None means now.
    scheduled_at: object = None


@dataclass
class Recipient:
    user: User
    link: LcupStudentLink
    phone: str
    text: str

    @property
    def name(self) -> str:
        return _name(self.user, self.link)


def _name(user, link=None) -> str:
    return f"{user.first_name} {user.last_name}".strip() or (link.name if link else "") or user.username


# ── the draft ─────────────────────────────────────────────────────────────


def _ints(raw) -> list[int] | None:
    """Distinct ids in the order given; None when anything is not a whole number."""
    if not isinstance(raw, (list, tuple)):
        return None
    out = []
    for value in raw:
        if isinstance(value, bool):
            return None
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        if number not in out:
            out.append(number)
    return out


def usable_template(raw) -> EskizTemplate:
    """The cached eskiz template ``raw`` names, if it can be sent (service or reklama)."""
    try:
        eskiz_id = None if isinstance(raw, bool) else int(raw)
    except (TypeError, ValueError):
        eskiz_id = None
    row = EskizTemplate.objects.filter(eskiz_id=eskiz_id).first() if eskiz_id is not None else None
    if row is None or not row.usable or not row.pattern:
        raise CampaignRefused("template", "Pick a template eskiz has approved (service or ad price).")
    return row


def clean_slots(pattern, roles, texts) -> tuple[list[str], list[str]]:
    """A role per slot and the typed texts, checked against the pattern's slots; non-text slots' texts become ""."""
    slots = T.slots(pattern)
    if not isinstance(roles, (list, tuple)) or len(roles) != len(slots) or any(r not in T.ROLES for r in roles):
        raise CampaignRefused("slots", f"Choose student, debt or text for each of the template's {len(slots)} slots.")
    if not isinstance(texts, (list, tuple)) or len(texts) != len(slots):
        raise CampaignRefused("slots", f"Send one text per slot ({len(slots)}).")
    roles = list(roles)
    texts = [str(t or "").strip() if r == T.ROLE_TEXT else "" for r, t in zip(roles, texts)]
    for number, (role, slot, text) in enumerate(zip(roles, slots, texts), 1):
        if role == T.ROLE_STUDENT and slot["kind"] == "d":
            raise CampaignRefused("slots", f"Slot {number} takes a number: it cannot hold a name.")
        if role != T.ROLE_TEXT:
            continue
        if not text:
            raise CampaignRefused("slots", f"Fill in the text for slot {number}.")
        if slot["kind"] == "d" and not _DIGITS.match(text):
            raise CampaignRefused("slots", f"Slot {number} takes a number: digits only.")
        if slot["kind"] == "w" and len(text.split()) > slot["max"]:
            raise CampaignRefused("slots", f"Slot {number} takes at most {slot['max']} words.")
    return roles, texts


def _audience(audience, raw_ids) -> tuple[str, tuple]:
    if audience not in (SmsCampaign.AUDIENCE_STUDENT, SmsCampaign.AUDIENCE_GROUP, SmsCampaign.AUDIENCE_DEBTORS):
        raise CampaignRefused("audience", "Choose who gets it: students, a class or the debtors.")
    if audience == SmsCampaign.AUDIENCE_DEBTORS:
        return audience, ()
    ids = _ints(raw_ids)
    if not ids:
        raise CampaignRefused("audience", "Pick at least one student." if audience == "student" else "Pick a class.")
    if audience == SmsCampaign.AUDIENCE_GROUP:
        if len(ids) != 1 or not Classroom.objects.filter(pk=ids[0], is_active=True).exists():
            raise CampaignRefused("audience", "Pick one active class.")
        return audience, tuple(ids)
    if len(ids) > LIMIT:
        raise CampaignRefused("over_limit", f"At most {LIMIT} students in one campaign.")
    found = set(User.objects.filter(pk__in=ids, role__in=C.LEARNER_ROLES).values_list("pk", flat=True))
    if len(found) != len(ids):
        raise CampaignRefused("audience", "A student in the list is not known.")
    return audience, tuple(ids)


def _when(raw, now):
    if raw in (None, ""):
        return None
    try:
        when = parse_datetime(str(raw))
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        when = None
    if when is None:
        raise CampaignRefused("past", "The send time is not a date and time.")
    if timezone.is_naive(when):
        when = timezone.make_aware(when)
    if when < now - PAST_GRACE:
        raise CampaignRefused("past", "That time has already passed.")
    return when


def clean(data, *, now) -> Draft:
    """The body of a preview or a create, checked; refusals carry the API's ``code``."""
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise CampaignRefused("body", "Send a JSON object.")
    template = usable_template(data.get("template_id"))
    roles, texts = clean_slots(template.pattern, data.get("slot_roles"), data.get("slot_texts"))
    audience, ids = _audience(data.get("audience"), data.get("audience_ids"))
    return Draft(
        template_id=template.eskiz_id, pattern=template.pattern, original=template.original,
        slot_roles=tuple(roles), slot_texts=tuple(texts), audience=audience, audience_ids=ids,
        scheduled_at=_when(data.get("scheduled_at"), now),
    )


# ── who, and what it says ─────────────────────────────────────────────────


def _people(campaign) -> list[tuple[User, LcupStudentLink | None]]:
    if campaign.audience == SmsCampaign.AUDIENCE_DEBTORS:
        # Frozen ones included: a debtor frozen on the 6th is exactly who a reminder is for.
        links = (
            LcupStudentLink.objects.filter(
                user__isnull=False, user__role__in=C.LEARNER_ROLES, balance__lt=0, deleted_in_lcup=False
            )
            .select_related("user")
            .order_by("lcup_student_id")
        )
        return [(link.user, link) for link in links]
    ids = list(campaign.audience_ids or ())
    if campaign.audience == SmsCampaign.AUDIENCE_GROUP:
        seats = (
            ClassroomMembership.objects.filter(
                classroom_id__in=ids, classroom__is_active=True,
                role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
            )
            .select_related("user")
            .order_by("user__first_name", "user__last_name", "user_id")
        )
        users = [seat.user for seat in seats]
    else:
        by_id = User.objects.filter(role__in=C.LEARNER_ROLES).in_bulk(ids)
        users = [by_id[i] for i in ids if i in by_id]
    links = {link.user_id: link for link in LcupStudentLink.objects.filter(user__in=users)}
    return [(user, links.get(user.pk)) for user in users]


def _owes(link) -> bool:
    # -0.40 would read "0 so'm": not a debt to name.
    return link.balance is not None and link.balance < 0 and int(abs(link.balance)) > 0


def _template_of(campaign) -> T.SmsTemplate:
    # One name per slot: two text slots hold two different texts.
    return T.SmsTemplate("campaign", campaign.pattern, tuple(f"s{i}" for i in range(len(campaign.slot_roles))))


def render_for(campaign, user, link, *, suffixes=None) -> str:
    """The text ``user`` gets. ``student`` is the lc-up name, up to four words, with whatever followed
    "(STUDENT)" in the submitted text (eskiz moderated "(STUDENT), sizda" into "%w{1,4} sizda");
    ``debt`` is what they owe; ``text`` is typed once for everyone. Raises ``TemplateError``."""
    if suffixes is None:
        suffixes = T.role_suffixes(campaign.original, campaign.pattern)
    values = {}
    for i, role in enumerate(campaign.slot_roles):
        if role == T.ROLE_STUDENT:
            name = (link.name if link else "").split() or user.get_full_name().split()
            values[f"s{i}"] = " ".join(name[:4]) + (suffixes[i] if name else "")
        elif role == T.ROLE_DEBT:
            if link is None or link.balance is None:
                raise T.TemplateError("campaign: the debt is not known")
            values[f"s{i}"] = int(abs(link.balance))
        else:
            values[f"s{i}"] = campaign.slot_texts[i]
    return T.render(_template_of(campaign), values)


def _stale(link, now) -> bool:
    return link.balance_seen_at is None or link.balance_seen_at < now - STALE_AFTER


def resolve(campaign, *, now=None) -> tuple[list[Recipient], dict]:
    """(who gets it, who does not and why) — one SMS per lc-up student, worked out as of ``now``.
    A debt named in the text, or a debtors list, needs a balance lc-up sent within STALE_AFTER:
    an older one may have been paid since (``stale_balance``)."""
    now = now or timezone.now()
    uses_debt = T.ROLE_DEBT in campaign.slot_roles
    needs_balance = uses_debt or campaign.audience == SmsCampaign.AUDIENCE_DEBTORS
    suffixes = T.role_suffixes(campaign.original, campaign.pattern)
    recipients, skipped = [], {reason: [] for reason in SKIP_REASONS}
    students, texts = set(), set()
    for user, link in _people(campaign):
        who = {"user_id": user.pk, "name": _name(user, link)}
        if link is None:
            skipped["no_link"].append(who)
            continue
        if link.lcup_student_id in students:
            continue
        phone = normalize_phone(link.phone)
        if not phone:
            skipped["no_phone"].append(who)
            continue
        if needs_balance and _stale(link, now):
            skipped["stale_balance"].append(who)
            continue
        if uses_debt and not _owes(link):
            skipped["not_debtor"].append(who)
            continue
        try:
            text = render_for(campaign, user, link, suffixes=suffixes)
        except T.TemplateError:
            skipped["bad_text"].append(who)
            continue
        if (phone, text) in texts:
            skipped.setdefault(SAME_PHONE, []).append(who)
            continue
        students.add(link.lcup_student_id)
        texts.add((phone, text))
        recipients.append(Recipient(user, link, phone, text))
    return recipients, skipped


def preview(data, *, now=None) -> dict:
    now = now or timezone.now()
    draft = clean(data, now=now)
    recipients, skipped = resolve(draft, now=now)
    parts = [T.parts(r.text) for r in recipients]
    total = sum(parts)
    return {
        "count": len(recipients),
        "over_limit": len(recipients) > LIMIT,
        "limit": LIMIT,
        "samples": [
            {"name": r.name, "phone": r.phone, "text": r.text, "parts": p} for r, p in zip(recipients[:SAMPLES], parts)
        ],
        "parts_total": total,
        "cost": total * switchboard.price_per_part(),
        "skipped": skipped,
    }


# ── create, send, cancel, retry ───────────────────────────────────────────


def _queue_send() -> None:
    from . import tasks

    tasks.send_due_campaigns.delay()


def create(data, user, *, now=None) -> SmsCampaign:
    """A campaign due now is queued at once (after the commit); a later one waits for the beat."""
    now = now or timezone.now()
    draft = clean(data, now=now)
    recipients, _ = resolve(draft, now=now)
    if not recipients:
        raise CampaignRefused("empty", "Nobody in that audience can get it: see who is skipped in the preview.")
    if len(recipients) > LIMIT:
        raise CampaignRefused("over_limit", f"{len(recipients)} recipients is more than {LIMIT}.")
    campaign = SmsCampaign.objects.create(
        template_eskiz_id=draft.template_id, pattern=draft.pattern, original=draft.original,
        slot_roles=list(draft.slot_roles), slot_texts=list(draft.slot_texts),
        audience=draft.audience, audience_ids=list(draft.audience_ids),
        scheduled_at=draft.scheduled_at or now, created_by=user,
    )
    if campaign.scheduled_at <= now:
        # robust: a broker hiccup must not fail a create that has committed; the minute beat sends it.
        transaction.on_commit(_queue_send, robust=True)
    return campaign


def due(now):
    return SmsCampaign.objects.filter(status=SmsCampaign.STATUS_SCHEDULED, scheduled_at__lte=now)


def stuck(now):
    """SENDING with a heartbeat older than STUCK_AFTER: the worker sending it is gone."""
    return SmsCampaign.objects.filter(status=SmsCampaign.STATUS_SENDING, started_at__lt=now - STUCK_AFTER)


def _load(pk) -> SmsCampaign:
    return SmsCampaign.objects.select_related("created_by").get(pk=pk)


def dispatch_due(client, now) -> int:
    """Every campaign whose time has come, each claimed once. The number sent."""
    sent = 0
    for pk in list(due(now).order_by("scheduled_at", "pk").values_list("pk", flat=True)):
        claimed = due(now).filter(pk=pk).update(status=SmsCampaign.STATUS_SENDING, started_at=now)
        if not claimed:
            continue  # another worker, or a cancel, got there first
        send_campaign(client, _load(pk), now)
        sent += 1
    return sent


def resume_stuck(client, now) -> int:
    """Every campaign a dead worker left SENDING, claimed again in one UPDATE (a fresh heartbeat,
    so the next beat leaves it alone) and finished. Whatever the dead worker got out is skipped:
    its SMS rows are there. The number resumed."""
    resumed = 0
    for pk in list(stuck(now).order_by("started_at", "pk").values_list("pk", flat=True)):
        if not stuck(now).filter(pk=pk).update(started_at=now):
            continue  # another beat took it
        logger.warning("campaign %s was left sending: resuming it", pk)
        send_campaign(client, _load(pk), now)
        resumed += 1
    return resumed


def _tally(campaign) -> dict:
    counts = {"sent": 0, "failed": 0, "rejected": 0, "uncertain": 0}
    for status in campaign.messages.values_list("status", flat=True):
        if status in _ACCEPTED:
            counts["sent"] += 1
        elif status == SmsMessage.STATUS_FAILED:
            counts["failed"] += 1
        elif status == SmsMessage.STATUS_REJECTED:
            counts["rejected"] += 1
        else:  # UNCERTAIN, or PENDING left by a run that died mid-request
            counts["uncertain"] += 1
    return counts


def _finish(campaign, status, now, *, error="", **result) -> SmsCampaign:
    campaign.status, campaign.finished_at, campaign.error = status, now, error[:400]
    campaign.result = {**EMPTY_RESULT, **result}
    campaign.save(update_fields=["status", "finished_at", "error", "result"])
    return campaign


def _key(campaign, link) -> str:
    return f"campaign:{campaign.pk}:student:{link.lcup_student_id}"


def run_on(campaign):
    """The day a campaign's SMS are filed under — the day it was scheduled for, not the day a resume
    or a retry happens to run: (kind, day, key) is the claim, and a new day would be a new claim."""
    return timezone.localdate(campaign.scheduled_at)


def _heartbeat(campaign) -> None:
    SmsCampaign.objects.filter(pk=campaign.pk, status=SmsCampaign.STATUS_SENDING).update(started_at=timezone.now())


def send_campaign(client, campaign, now=None) -> SmsCampaign:
    """A claimed (SENDING) campaign, out. One recipient going wrong does not stop the rest;
    BREAKER_AFTER going wrong in a row do. Safe to run again: what already left is skipped."""
    now = now or timezone.now()
    try:
        recipients, skipped = resolve(campaign, now=now)
    except Exception as exc:  # the type only: a message can quote a phone
        logger.warning("campaign %s: the recipients could not be worked out: %s", campaign.pk, type(exc).__name__)
        return _finish(campaign, SmsCampaign.STATUS_FAILED, now, error=f"the recipients could not be worked out ({type(exc).__name__})")
    if len(recipients) > LIMIT:
        return _finish(
            campaign, SmsCampaign.STATUS_FAILED, now, skipped=skipped,
            error=f"{len(recipients)} recipients is more than {LIMIT}: nothing was sent",
        )
    day, errors, in_a_row = run_on(campaign), 0, 0
    for i, r in enumerate(recipients):
        if i and i % HEARTBEAT_EVERY == 0:
            _heartbeat(campaign)
        try:
            msg = deliver(
                client, kind=SmsMessage.KIND_CAMPAIGN, run_on=day, dedupe_key=_key(campaign, r.link),
                phone=r.phone, text=r.text, user=r.user, lcup_student_id=r.link.lcup_student_id,
                campaign=campaign, created_by=campaign.created_by,
            )
        except Exception as exc:
            logger.warning(
                "campaign %s to lc-up student %s went wrong: %s", campaign.pk, r.link.lcup_student_id, type(exc).__name__
            )
            errors += 1
            in_a_row += 1
        else:
            if msg is None:
                continue  # already out (a resume, a retry): not a send, either way
            in_a_row = in_a_row + 1 if msg.status in _BROKEN else 0
        if in_a_row >= BREAKER_AFTER:
            tally = _tally(campaign)
            logger.warning("campaign %s stopped: %s sends in a row went wrong", campaign.pk, in_a_row)
            return _finish(
                campaign, SmsCampaign.STATUS_FAILED, now, **tally, errors=errors, skipped=skipped,
                error=f"eskiz kept failing — stopped after {tally['sent']} sent; press Retry to continue",
            )
    return _finish(campaign, SmsCampaign.STATUS_DONE, now, **_tally(campaign), errors=errors, skipped=skipped)


def cancel(campaign, *, now=None) -> SmsCampaign:
    """Only before it goes out: one UPDATE, so a cancel and the beat's claim cannot both win."""
    cancelled = SmsCampaign.objects.filter(pk=campaign.pk, status=SmsCampaign.STATUS_SCHEDULED).update(
        status=SmsCampaign.STATUS_CANCELLED, finished_at=now or timezone.now()
    )
    if not cancelled:
        raise CampaignRefused("not_scheduled", "Only a scheduled campaign can be cancelled.")
    campaign.refresh_from_db()
    return campaign


def check_retryable(campaign) -> None:
    """Retry is for a DONE or a stopped (FAILED) campaign only: ``not_done`` otherwise."""
    if campaign.status not in RETRYABLE:
        raise CampaignRefused("not_done", "Only a finished or stopped campaign can be retried.")


def to_resend(campaign, *, now=None) -> int:
    """How many a resume would send, best effort: the recipients as of now with no SMS yet or a FAILED one."""
    try:
        recipients, _ = resolve(campaign, now=now)
    except Exception:  # the send will say why; the count falls back to what is known to have failed
        return campaign.messages.filter(status=SmsMessage.STATUS_FAILED).count()
    states = dict(campaign.messages.values_list("dedupe_key", "status"))
    return sum(1 for r in recipients if states.get(_key(campaign, r.link)) in (None, SmsMessage.STATUS_FAILED))


def retry(campaign, *, now=None) -> int:
    """Retry, from the panel: a DONE or FAILED campaign is claimed SENDING again in one UPDATE (so
    a second click, or a second admin, is refused) and ``resume`` sends it. How many it would send."""
    now = now or timezone.now()
    check_retryable(campaign)
    queued = to_resend(campaign, now=now)
    claimed = SmsCampaign.objects.filter(pk=campaign.pk, status__in=RETRYABLE).update(
        status=SmsCampaign.STATUS_SENDING, started_at=now, finished_at=None, error="",
    )
    if not claimed:  # another click, another admin, got there first
        raise CampaignRefused("not_done", "This campaign is already being sent again.")
    campaign.refresh_from_db()
    return queued


def resume(client, campaign_id, *, now=None) -> SmsCampaign | None:
    """The send a retry queued: the campaign, if it is still the SENDING one ``retry`` claimed (the
    reaper may have finished it meanwhile), out again through ``send_campaign``."""
    campaign = SmsCampaign.objects.select_related("created_by").filter(
        pk=campaign_id, status=SmsCampaign.STATUS_SENDING
    ).first()
    if campaign is None:
        return None
    return send_campaign(client, campaign, now)


# ── reading ───────────────────────────────────────────────────────────────


def audience_labels(campaigns) -> dict[int, str]:
    """"Debtors", "Group: <class>", "Student: <name>" or "<n> students", for each campaign's pk."""
    campaigns = list(campaigns)
    rooms = {
        c.audience_ids[0] for c in campaigns if c.audience == SmsCampaign.AUDIENCE_GROUP and c.audience_ids
    }
    singles = {
        c.audience_ids[0] for c in campaigns if c.audience == SmsCampaign.AUDIENCE_STUDENT and len(c.audience_ids) == 1
    }
    room_names = dict(Classroom.objects.filter(pk__in=rooms).values_list("pk", "name"))
    people = User.objects.in_bulk(singles)
    labels = {}
    for c in campaigns:
        ids = list(c.audience_ids or [])
        if c.audience == SmsCampaign.AUDIENCE_DEBTORS:
            labels[c.pk] = "Debtors"
        elif c.audience == SmsCampaign.AUDIENCE_GROUP:
            labels[c.pk] = f"Group: {room_names.get(ids[0], 'a deleted class') if ids else 'none'}"
        elif len(ids) == 1:
            person = people.get(ids[0])
            labels[c.pk] = f"Student: {_name(person) if person else 'a deleted account'}"
        else:
            labels[c.pk] = f"{len(ids)} students"
    return labels


def audience_label(campaign) -> str:
    return audience_labels([campaign])[campaign.pk]


def live_counts(campaign_ids) -> dict[int, dict]:
    """campaign pk → {delivered, undelivered}, counted from its messages now."""
    out: dict[int, dict] = {pk: {"delivered": 0, "undelivered": 0} for pk in campaign_ids}
    rows = SmsMessage.objects.filter(
        campaign_id__in=campaign_ids, status__in=(SmsMessage.STATUS_DELIVERED, SmsMessage.STATUS_UNDELIVERED)
    ).values_list("campaign_id", "status")
    for pk, status in rows:
        out[pk]["delivered" if status == SmsMessage.STATUS_DELIVERED else "undelivered"] += 1
    return out
