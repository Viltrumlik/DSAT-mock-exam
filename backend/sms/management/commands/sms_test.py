import uuid

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from lcup.phones import normalize_phone
from sms import conf
from sms import templates as T
from sms.delivery import deliver
from sms.eskiz import default_client
from sms.models import SmsMessage


class Command(BaseCommand):
    help = "The debt warning filled with sample values; with --send, one real SMS to --phone (logged as a test)."

    def add_arguments(self, parser):
        parser.add_argument("--phone", required=True)
        parser.add_argument("--send", action="store_true", help="really send it; without this only print it")
        parser.add_argument("--last-day", action="store_true", help="the last-day text (\"Bugun oxirgi kun!\")")

    def handle(self, *args, **options):
        phone = normalize_phone(options["phone"])
        if not phone:
            raise CommandError("not an Uzbek phone number (998XXXXXXXXX)")
        template = T.DEBT_LAST_DAY if options["last_day"] else T.DEBT_WARNING
        if template is None:
            raise CommandError("no approved template yet: copy it in from manage.py eskiz_account")
        text = T.render(template, T.SAMPLE_VALUES)
        plain = "plain" if T.is_gsm_safe(text) else "NOT plain"
        self.stdout.write(f"{text}\n({len(text)} characters, {plain} ASCII)")
        if not options["send"]:
            self.stdout.write("not sent: add --send")
            return
        if not conf.is_configured():
            raise CommandError("ESKIZ_EMAIL / ESKIZ_SECRET_KEY are not set")
        msg = deliver(
            default_client(), kind=SmsMessage.KIND_TEST, run_on=timezone.localdate(),
            dedupe_key=f"test:{uuid.uuid4().hex[:16]}", phone=phone, text=text,
        )
        self.stdout.write(f"{msg.status} {msg.request_id} {msg.error}".strip())
