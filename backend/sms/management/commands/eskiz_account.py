import json

from django.core.management.base import BaseCommand, CommandError

from sms import conf
from sms.eskiz import EskizError, default_client
from sms.templates import is_gsm_safe


class Command(BaseCommand):
    help = (
        "eskiz.uz: the balance, the approved sender names and every template, exactly as eskiz holds it "
        "(repr, so a stray space shows). Read-only. Logs in only when no token is cached — the account "
        "is shared with lc-up."
    )

    def handle(self, *args, **options):
        if not conf.is_configured():
            raise CommandError("ESKIZ_EMAIL / ESKIZ_SECRET_KEY are not set")
        client = default_client()
        try:
            balance, nicks, templates = client.balance(), client.nicks(), client.templates()
        except EskizError as exc:
            raise CommandError(str(exc))
        self.stdout.write(f"balance: {balance}")
        self.stdout.write(f"sender names: {json.dumps(nicks, ensure_ascii=False)}")
        for row in templates:
            text = str(row.get("original_text") or row.get("template") or "")
            warning = "" if is_gsm_safe(text) else "  ! not plain ASCII: 70 characters a part, about twice the price"
            self.stdout.write(f"#{row.get('id')} [{row.get('status')}]{warning}\n{text!r}")
