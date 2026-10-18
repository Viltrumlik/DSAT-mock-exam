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
            # ``template`` is eskiz's moderated pattern (%w/%d slots) — what a text is matched against and
            # what goes into sms.templates; ``original_text`` is what was submitted (lc-up's "(STUDENT)").
            pattern, original = str(row.get("template") or ""), str(row.get("original_text") or "")
            plain = is_gsm_safe(pattern + original)
            warning = "" if plain else "  ! not plain ASCII: 70 characters a part, about twice the price"
            self.stdout.write(
                f"#{row.get('id')} [{row.get('status')}]{warning}\n  pattern:  {pattern!r}\n  original: {original!r}"
            )
