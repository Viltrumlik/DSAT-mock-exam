"""Stand-ins for eskiz: :class:`FakeEskiz` for the client, :class:`EskizAccount` for its far end."""

from django.core.cache.backends.locmem import LocMemCache

from .eskiz import ACCEPTED, EskizClient, EskizError, SendResult, StatusResult


class FakeEskiz:
    """``template_rows`` is the account's template list as eskiz answers it; a submitted text joins
    it as ``moderation``. ``account_error`` makes every account read and the submit raise, as an
    unreachable eskiz or a refused login does. ``outcomes`` answers the first sends one by one
    before ``outcome`` takes over: ``FakeEskiz(FAILED, outcomes=[ACCEPTED] * 2)`` fails after two."""

    def __init__(
        self, outcome=ACCEPTED, statuses=None, *, outcomes=(), template_rows=None, balance=125000, account_error="",
        forbidden=(), check_error=False,
    ):
        self.outcome = outcome
        self.outcomes = list(outcomes)
        self.statuses = dict(statuses or {})
        self.sent = []
        self.template_rows = [dict(row) for row in template_rows or []]
        self.submitted = []
        self.balance_value = balance
        self.account_error = account_error
        self.balance_calls = 0
        #: eskiz's word list as this fake knows it: a text holding one of these (case-insensitive) is forbidden.
        self.forbidden = {w.lower() for w in forbidden}
        self.check_error = check_error
        self.checked = []

    def send(self, phone, text, *, user_sms_id=""):
        self.sent.append((phone, text, user_sms_id))
        outcome = self.outcomes.pop(0) if self.outcomes else self.outcome
        if outcome == ACCEPTED:
            return SendResult(ACCEPTED, request_id=f"req-{len(self.sent)}")
        return SendResult(outcome, error="refused by the fake")

    def check(self, text):
        self.checked.append(text)
        if self.check_error:
            return None
        hits = sorted(w for w in self.forbidden if w in text.lower())
        return {"forbidden": bool(hits), "keywords": hits}

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


class _Answer:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self.body = body

    def json(self):
        return self.body


class EskizAccount:
    """eskiz's end of the wire, to run the real client through a morning with no money on the account:
    a send is refused in eskiz's words until ``top_up``, then taken. ``refused`` maps a phone to the
    refusal it gets whatever the balance ("perfectum: Not allowed"). ``asked`` counts the sends that
    reached eskiz, ``taken`` lists the phones it took, one per SMS."""

    def __init__(self, *, refused=None):
        self.funded = False
        self.refused = dict(refused or {})
        self.asked = 0
        self.taken = []

    def top_up(self):
        self.funded = True

    def client(self) -> EskizClient:
        return EskizClient(
            base_url="https://eskiz.test/api", email="ops@example.uz", secret="key", sender="4546",
            session=self, cache=LocMemCache(f"eskiz-account-{id(self)}", {}),
        )

    def request(self, method, url, data=None, json=None, headers=None, timeout=None):
        if url.endswith("/auth/login"):
            return _Answer(200, {"data": {"token": "jwt"}})
        if url.endswith("/message/sms/check"):
            return _Answer(200, {"data": {"forbidden": False, "keywords": []}})
        self.asked += 1
        phone = data["mobile_phone"]
        if phone in self.refused:
            return _Answer(400, {"message": self.refused[phone]})
        if not self.funded:
            return _Answer(400, {"message": "Please, fill the balance"})
        self.taken.append(phone)
        return _Answer(200, {"id": f"req-{len(self.taken)}", "message": "Waiting for SMS provider", "status": "waiting"})


def configure(**fields):
    """Set the panel's ``SmsSettings`` for a test (the row is created lazily, so ``update`` alone
    would change nothing)."""
    from .models import SmsSettings

    SmsSettings.get()
    SmsSettings.objects.filter(pk=1).update(**fields)
    return SmsSettings.get()
