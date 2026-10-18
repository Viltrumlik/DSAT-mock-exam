"""A stand-in for :class:`sms.eskiz.EskizClient` that records what would have been sent."""

from .eskiz import ACCEPTED, SendResult, StatusResult


class FakeEskiz:
    def __init__(self, outcome=ACCEPTED, statuses=None):
        self.outcome = outcome
        self.statuses = dict(statuses or {})
        self.sent = []

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
