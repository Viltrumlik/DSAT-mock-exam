"""eskiz's templates, cached in ``EskizTemplate`` so /ops/sms can list and pick them without a
request to eskiz each time (the account is shared with lc-up; logins stay rare).

``sync`` copies ``GET /user/templates`` in: by a button and by the 09:00 beat. A row eskiz no
longer lists is kept as ``gone`` — a campaign or a setting that named it still reads — but an empty
answer marks nothing: an account with no templates at all is a glitch, not eskiz deleting them all.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .eskiz import EskizError
from .models import EskizTemplate

#: eskiz takes longer texts, but nothing the centre sends needs more than a few SMS parts.
MAX_TEMPLATE_LENGTH = 1000


class TemplateRefused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def sync(client, now=None) -> dict:
    """Raises ``EskizError`` when eskiz cannot be read; then nothing changes."""
    rows = client.templates()
    now = now or timezone.now()
    existing = {t.eskiz_id: t for t in EskizTemplate.objects.all()}
    added = updated = 0
    seen = set()
    with transaction.atomic():
        for row in rows:
            eskiz_id = _int(row.get("id")) if isinstance(row, dict) else None
            if eskiz_id is None or eskiz_id < 0 or eskiz_id in seen:
                continue
            seen.add(eskiz_id)
            fields = {
                "pattern": str(row.get("template") or ""),
                "original": str(row.get("original_text") or ""),
                "status": str(row.get("status") or "").strip().lower()[:16],
                "synced_at": now,
            }
            obj = existing.get(eskiz_id)
            if obj is None:
                EskizTemplate.objects.create(eskiz_id=eskiz_id, **fields)
                added += 1
                continue
            for name, value in fields.items():
                setattr(obj, name, value)
            obj.save(update_fields=list(fields))
            updated += 1
        gone = 0
        if seen:
            gone = (
                EskizTemplate.objects.exclude(eskiz_id__in=seen)
                .exclude(status=EskizTemplate.STATUS_GONE)
                .update(status=EskizTemplate.STATUS_GONE, synced_at=now)
            )
    return {"added": added, "updated": updated, "gone": gone, "total": len(seen)}


def clean_text(text) -> str:
    text = str(text or "").strip()
    if not text:
        raise TemplateRefused("text", "Write the text first.")
    if len(text) > MAX_TEMPLATE_LENGTH:
        raise TemplateRefused("text", f"The text is longer than {MAX_TEMPLATE_LENGTH} characters.")
    if not any(ch.isalpha() for ch in text):
        raise TemplateRefused("text", "The text has no words.")
    return text


def submit(client, text, user, now=None) -> tuple[EskizTemplate | None, dict]:
    """A new text to eskiz's moderation, then a sync so it shows at once. The row is None when eskiz
    has not listed it yet. A sync that fails after the submit went through is reported in the
    counts, not raised: the text is with eskiz, and sending it again would make a second one."""
    text = clean_text(text)
    now = now or timezone.now()
    try:
        client.submit_template(text)
    except EskizError as exc:
        raise TemplateRefused("eskiz", str(exc)) from None
    try:
        counts = sync(client, now)
    except EskizError as exc:
        return None, {"added": 0, "updated": 0, "gone": 0, "total": 0, "error": str(exc)}
    row = EskizTemplate.objects.filter(original=text).order_by("-eskiz_id").first()
    if row is not None and row.submitted_at is None:
        row.submitted_by, row.submitted_at = user, now
        row.save(update_fields=["submitted_by", "submitted_at"])
    return row, counts


def usable():
    return EskizTemplate.objects.filter(status__in=EskizTemplate.USABLE_STATUSES)
