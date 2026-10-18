"""A stand-in for :class:`sms.eskiz.EskizClient` that records what would have been sent."""

from .eskiz import ACCEPTED, EskizError, SendResult, StatusResult


class FakeEskiz:
    """``template_rows`` is the account's template list as eskiz answers it; a submitted text joins
    it as ``moderation``. ``account_error`` makes every account read and the submit raise, as an
    unreachable eskiz or a refused login does."""

    def __init__(self, outcome=ACCEPTED, statuses=None, *, template_rows=None, balance=125000, account_error=""):
        self.outcome = outcome
        self.statuses = dict(statuses or {})
        self.sent = []
        self.template_rows = [dict(row) for row in template_rows or []]
        self.submitted = []
        self.balance_value = balance
        self.account_error = account_error
        self.balance_calls = 0

    def send(self, phone, text, *, user_sms_id=""):
        self.sent.append((phone, text, user_sms_id))
        if self.outcome == ACCEPTED:
            return SendResult(ACCEPTED, request_id=f"req-{len(self.sent)}")
        return SendResult(self.outcome, error="refused by the fake")

    def status(self, request_id):
        status = self.statuses.get(request_id)
        if status is None:
            return StatusResult(False, error="unknown to the fake")
        return StatusResult(True, status=status, parts=1)

    def _account(self):
        if self.account_error:
            raise EskizError(self.account_error)

    def templates(self):
        self._account()
        return [dict(row) for row in self.template_rows]

    def submit_template(self, text):
        self._account()
        self.submitted.append(text)
        next_id = max((int(row["id"]) for row in self.template_rows), default=0) + 1
        self.template_rows.append({"id": next_id, "template": "", "original_text": text, "status": "moderation"})
        return {"success": True}

    def balance(self):
        self.balance_calls += 1
        self._account()
        return self.balance_value


def configure(**fields):
    """Set the panel's ``SmsSettings`` for a test (the row is created lazily, so ``update`` alone
    would change nothing)."""
    from .models import SmsSettings

    SmsSettings.get()
    SmsSettings.objects.filter(pk=1).update(**fields)
    return SmsSettings.get()
