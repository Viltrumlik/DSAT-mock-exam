"""eskiz's templates, cached: the sync, and a new text sent to moderation."""

from datetime import datetime

from django.test import TestCase
from django.utils import timezone

from sms import eskiz_templates
from sms.eskiz_templates import TemplateRefused
from sms.models import EskizTemplate
from sms.testing import FakeEskiz
from users.models import User

NOW = timezone.make_aware(datetime(2026, 10, 18, 9, 0))
ROWS = [
    {"id": 64942, "template": "MASTER %w{1,4} sizda", "original_text": "MASTER (STUDENT), sizda", "status": "service"},
    {"id": 70001, "template": "", "original_text": "Yangi (STUDENT)", "status": "moderation"},
]


class SyncTests(TestCase):
    def test_adds_updates_and_marks_gone(self):
        EskizTemplate.objects.create(eskiz_id=64942, pattern="old", status="moderation", synced_at=NOW)
        EskizTemplate.objects.create(eskiz_id=5, pattern="deleted in eskiz", status="service", synced_at=NOW)
        counts = eskiz_templates.sync(FakeEskiz(template_rows=ROWS), now=NOW)
        self.assertEqual(counts, {"added": 1, "updated": 1, "gone": 1, "total": 2})
        live = EskizTemplate.objects.get(eskiz_id=64942)
        self.assertEqual((live.pattern, live.original, live.status), ("MASTER %w{1,4} sizda", "MASTER (STUDENT), sizda", "service"))
        self.assertEqual(EskizTemplate.objects.get(eskiz_id=5).status, "gone")
        self.assertEqual(EskizTemplate.objects.get(eskiz_id=70001).status, "moderation")

    def test_a_second_sync_marks_nothing_gone_twice(self):
        EskizTemplate.objects.create(eskiz_id=5, pattern="x", status="gone", synced_at=NOW)
        self.assertEqual(eskiz_templates.sync(FakeEskiz(template_rows=ROWS), now=NOW)["gone"], 0)

    def test_an_empty_answer_marks_nothing_gone(self):
        # An account with no templates at all is a glitch, not eskiz deleting every one of them.
        EskizTemplate.objects.create(eskiz_id=64942, pattern="x", status="service", synced_at=NOW)
        self.assertEqual(eskiz_templates.sync(FakeEskiz(), now=NOW), {"added": 0, "updated": 0, "gone": 0, "total": 0})
        self.assertEqual(EskizTemplate.objects.get().status, "service")

    def test_usable_is_service_and_reklama(self):
        rows = ROWS + [{"id": 3, "template": "Aksiya %w", "original_text": "Aksiya", "status": "reklama"}]
        eskiz_templates.sync(FakeEskiz(template_rows=rows), now=NOW)
        self.assertEqual(sorted(eskiz_templates.usable().values_list("eskiz_id", flat=True)), [3, 64942])


class SubmitTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")

    def test_sends_syncs_and_stamps_the_user(self):
        fake = FakeEskiz(template_rows=ROWS)
        row, counts = eskiz_templates.submit(fake, "  Salom (STUDENT)! Darsga keling.  ", self.admin, now=NOW)
        self.assertEqual(fake.submitted, ["Salom (STUDENT)! Darsga keling."])
        self.assertEqual(counts["added"], 3)
        self.assertEqual((row.original, row.status, row.submitted_by, row.submitted_at), (
            "Salom (STUDENT)! Darsga keling.", "moderation", self.admin, NOW,
        ))

    def test_refuses_an_empty_an_over_long_or_a_letterless_text(self):
        fake = FakeEskiz()
        for text in ("", "   ", "a" * 1001, "123 456"):
            with self.subTest(length=len(text)), self.assertRaises(TemplateRefused) as caught:
                eskiz_templates.submit(fake, text, self.admin, now=NOW)
            self.assertEqual(caught.exception.code, "text")
        self.assertEqual(fake.submitted, [])

    def test_eskiz_refusing_says_so(self):
        with self.assertRaises(TemplateRefused) as caught:
            eskiz_templates.submit(FakeEskiz(account_error="HTTP 422: template taken"), "Salom", self.admin, now=NOW)
        self.assertEqual((caught.exception.code, caught.exception.message), ("eskiz", "HTTP 422: template taken"))
