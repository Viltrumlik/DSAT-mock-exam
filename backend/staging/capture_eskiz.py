"""eskiz as the test copy sees it: ``sms.eskiz.default_client()`` returns this while ``staging.outbound.captured()``.

It has the methods the SMS code calls on ``EskizClient`` (``sms.delivery``, ``sms.forbidden``, ``sms.tasks``, the
template sync, /ops/sms and ``eskiz_account``), modelled on ``sms.testing.FakeEskiz``. Every SMS is written to the
toolbox's Messages and taken as eskiz takes one; eskiz later says it was delivered. Nothing leaves the server."""

from __future__ import annotations

import uuid

from django.utils import timezone

from sms import conf
from sms.eskiz import ACCEPTED, SendResult, StatusResult

from .outbound import capture

#: The account's balance on the copy, in so'm.
BALANCE = 999_999


class CaptureEskiz:
    def send(self, phone, text, *, user_sms_id="") -> SendResult:
        capture("sms", phone, text, meta={"user_sms_id": user_sms_id, "sender": conf.credentials()["sender"]})
        return SendResult(ACCEPTED, request_id=f"stg-{uuid.uuid4().hex}")

    def status(self, request_id) -> StatusResult:
        from sms.models import SmsMessage

        parts = SmsMessage.objects.filter(request_id=request_id).values_list("parts", flat=True).first()
        return StatusResult(True, status="DELIVERED", parts=parts or 1)

    def check(self, text) -> dict:
        return {"forbidden": False, "keywords": []}

    def templates(self) -> list[dict]:
        """The templates the copy already holds, as eskiz lists them: the 09:00 sync then changes nothing."""
        from sms.models import EskizTemplate

        return [
            {"id": t.eskiz_id, "template": t.pattern, "original_text": t.original, "status": t.status}
            for t in EskizTemplate.objects.order_by("eskiz_id")
        ]

    def submit_template(self, text) -> dict:
        """Joins the list as ``moderation``, as a new text does at eskiz; nobody moderates it on the copy."""
        from sms.models import EskizTemplate

        last = EskizTemplate.objects.order_by("-eskiz_id").values_list("eskiz_id", flat=True).first() or 0
        EskizTemplate.objects.create(
            eskiz_id=last + 1, original=str(text), status=EskizTemplate.STATUS_MODERATION, synced_at=timezone.now()
        )
        return {"success": True}

    def nicks(self) -> list:
        return [conf.credentials()["sender"]]

    def balance(self) -> int:
        return BALANCE
