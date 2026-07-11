"""
Tests for the question error-report feature.

    python manage.py test question_reports --settings=config.settings_test_nomigrations
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from assessments.models import AssessmentQuestion, AssessmentSet
from exams.models import PracticeTest, PracticeTestPack, Question
from midterms.tests_api import make_published_midterm
from mocks.tests_scoring import make_mock

from question_reports.models import QuestionErrorReport, TelegramReportSubscriber
from question_reports.targets import build_report_message, resolve_target

User = get_user_model()


def _add_question(module, order=0, text="What is the answer?", qtype="READING"):
    return Question.objects.create(
        module=module,
        question_type=qtype,
        question_text=text,
        option_a="A",
        option_b="B",
        option_c="C",
        option_d="D",
        correct_answers="a",
        is_math_input=False,
        score=10,
        order=order,
    )


class ResolverTests(TestCase):
    """resolve_target derives the correct resource identity + snapshot for every type."""

    @classmethod
    def setUpTestData(cls):
        cls.staff = User.objects.create(username="author", email="a@x.io", role="admin")

    def test_pastpaper(self):
        pt = PracticeTest.objects.create(
            subject="READING_WRITING", title="Section", collection_name="March 2024", is_published=True
        )
        module = pt.modules.get(module_order=1)
        # exams.Question.save enforces a dense 0..n-1 order, so create 3 and target the last.
        for i in range(3):
            q = _add_question(module, order=i, text=f"Question {i} answer?")
        t = resolve_target("exam", q.id)
        self.assertEqual(t.resource_type, QuestionErrorReport.RESOURCE_PASTPAPER)
        self.assertEqual(t.resource_id, pt.id)
        self.assertEqual(t.resource_title, "March 2024")
        self.assertEqual(t.question_order, 3)  # 1-based; 3rd question -> order 2 -> 3
        self.assertIn("answer", t.question_excerpt.lower())

    def test_practice_test(self):
        pack = PracticeTestPack.objects.create(title="Pack A", is_published=True)
        pt = PracticeTest.objects.create(
            practice_test_pack=pack, subject="MATH", title="Sec", is_published=True
        )
        q = _add_question(pt.modules.get(module_order=1), qtype="MATH")
        t = resolve_target("exam", q.id)
        self.assertEqual(t.resource_type, QuestionErrorReport.RESOURCE_PRACTICE_TEST)
        self.assertEqual(t.resource_id, pack.id)
        self.assertEqual(t.resource_title, "Pack A")

    def test_mock(self):
        mock, mods = make_mock()
        q = mods[0].questions.order_by("order").first()
        t = resolve_target("exam", q.id)
        self.assertEqual(t.resource_type, QuestionErrorReport.RESOURCE_MOCK)
        self.assertEqual(t.resource_id, mock.id)
        self.assertEqual(t.resource_title, "Full Mock")

    def test_midterm(self):
        mt = make_published_midterm(n=3)
        q = mt.questions().first()
        t = resolve_target("exam", q.id)
        self.assertEqual(t.resource_type, QuestionErrorReport.RESOURCE_MIDTERM)
        self.assertEqual(t.resource_id, mt.id)
        self.assertEqual(t.resource_title, "Unit 1 Midterm")

    def test_assessment(self):
        aset = AssessmentSet.objects.create(subject="english", title="Set X", created_by=self.staff)
        aq = AssessmentQuestion.objects.create(
            assessment_set=aset, order=0, prompt="The passage mainly argues…", question_type="short_text"
        )
        t = resolve_target("assessment", aq.id)
        self.assertEqual(t.resource_type, QuestionErrorReport.RESOURCE_ASSESSMENT)
        self.assertEqual(t.resource_id, aset.id)
        self.assertEqual(t.resource_title, "Set X")
        self.assertEqual(t.question_order, 1)

    def test_missing_returns_none(self):
        self.assertIsNone(resolve_target("exam", 999999))
        self.assertIsNone(resolve_target("assessment", 999999))


class CreateEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create(username="stud", email="s@x.io", role="student")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.mt = make_published_midterm(n=3)
        self.q = self.mt.questions().first()

    def test_create_persists_snapshot(self):
        r = self.client.post(
            "/api/question-reports/reports/",
            {"system": "exam", "question_id": self.q.id, "category": "answer_key", "message": "B should be correct"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        report = QuestionErrorReport.objects.get(pk=r.json()["id"])
        self.assertEqual(report.resource_type, QuestionErrorReport.RESOURCE_MIDTERM)
        self.assertEqual(report.resource_id, self.mt.id)
        self.assertEqual(report.resource_title, "Unit 1 Midterm")
        self.assertEqual(report.question_order, 1)
        self.assertEqual(report.category, "answer_key")
        self.assertEqual(report.reporter_id, self.user.id)
        self.assertEqual(report.status, QuestionErrorReport.STATUS_NEW)

    def test_unknown_question_is_404(self):
        r = self.client.post(
            "/api/question-reports/reports/",
            {"system": "exam", "question_id": 424242},
            format="json",
        )
        self.assertEqual(r.status_code, 404, r.content)
        self.assertEqual(QuestionErrorReport.objects.count(), 0)

    def test_dedupe_same_question_returns_existing(self):
        payload = {"system": "exam", "question_id": self.q.id, "category": "typo_unclear"}
        r1 = self.client.post("/api/question-reports/reports/", payload, format="json")
        self.assertEqual(r1.status_code, 201, r1.content)
        r2 = self.client.post("/api/question-reports/reports/", payload, format="json")
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertTrue(r2.json().get("deduped"))
        self.assertEqual(r1.json()["id"], r2.json()["id"])
        self.assertEqual(QuestionErrorReport.objects.count(), 1)

    def test_frozen_student_blocked(self):
        frozen = User.objects.create(username="frz", email="f@x.io", role="student", is_frozen=True)
        c = APIClient()
        c.force_authenticate(frozen)
        r = c.post(
            "/api/question-reports/reports/",
            {"system": "exam", "question_id": self.q.id},
            format="json",
        )
        self.assertEqual(r.status_code, 403, r.content)

    def test_anonymous_blocked(self):
        r = APIClient().post(
            "/api/question-reports/reports/",
            {"system": "exam", "question_id": self.q.id},
            format="json",
        )
        self.assertIn(r.status_code, (401, 403))

    def test_bad_system_rejected(self):
        r = self.client.post(
            "/api/question-reports/reports/",
            {"system": "nonsense", "question_id": self.q.id},
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.content)


@override_settings(
    QUESTION_REPORT_TELEGRAM_BOT_TOKEN="TESTTOKEN",
    QUESTION_REPORT_TELEGRAM_CHAT_ID="-100group",
)
class NotificationFanoutTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="rep", email="r@x.io", role="student")
        self.mt = make_published_midterm(n=2)

    def test_fanout_hits_group_and_active_subscribers(self):
        from question_reports import tasks

        TelegramReportSubscriber.objects.create(chat_id="555", is_active=True)
        TelegramReportSubscriber.objects.create(chat_id="666", is_active=False)  # skipped

        report = QuestionErrorReport.objects.create(
            system="exam",
            question_id=self.mt.questions().first().id,
            resource_type=QuestionErrorReport.RESOURCE_MIDTERM,
            resource_id=self.mt.id,
            resource_title="Unit 1 Midterm",
            question_order=1,
            question_excerpt="What is the answer?",
            category="wrong_answer",
            message="No option is right",
            reporter=self.user,
        )
        with patch.object(tasks, "send_telegram_message", side_effect=[101, 102]) as send:
            result = tasks.notify_question_report_async(report.id)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["sent"], 2)
        chats = {c.kwargs["chat_id"] for c in send.call_args_list}
        self.assertEqual(chats, {"-100group", "555"})
        text = send.call_args_list[0].kwargs["text"]
        self.assertIn("Question error report", text)
        self.assertIn("Unit 1 Midterm", text)
        self.assertIn("Not fixed", text)  # status line
        # Each sent copy is recorded so a later "Fixed" tap can update them all.
        report.refresh_from_db()
        self.assertEqual(
            report.telegram_messages,
            [{"chat_id": "-100group", "message_id": 101}, {"chat_id": "555", "message_id": 102}],
        )

    def test_message_escapes_html(self):
        report = QuestionErrorReport.objects.create(
            system="exam",
            question_id=1,
            resource_type=QuestionErrorReport.RESOURCE_MIDTERM,
            resource_title="A & B <script>",
            question_order=1,
            category="other",
            message="1 < 2 & 3 > 2",
            reporter=self.user,
        )
        msg = build_report_message(report)
        self.assertNotIn("<script>", msg)
        self.assertIn("&lt;script&gt;", msg)
        self.assertIn("1 &lt; 2 &amp; 3 &gt; 2", msg)


@override_settings(
    QUESTION_REPORT_TELEGRAM_BOT_TOKEN="TESTTOKEN",
    QUESTION_REPORT_TELEGRAM_CHAT_ID="-100grp",
    QUESTION_REPORT_TELEGRAM_TOPIC_ID="65",
)
class TopicRoutingTests(TestCase):
    """The staff-group copy goes to the configured forum topic; DM subscribers don't."""

    def test_group_goes_to_topic_subscribers_do_not(self):
        from question_reports import tasks

        TelegramReportSubscriber.objects.create(chat_id="555", is_active=True)
        mt = make_published_midterm(n=1)
        report = QuestionErrorReport.objects.create(
            system="exam",
            question_id=mt.questions().first().id,
            resource_type=QuestionErrorReport.RESOURCE_MIDTERM,
            resource_title="U",
            question_order=1,
            category="other",
        )
        with patch.object(tasks, "send_telegram_message", side_effect=[10, 11]) as send:
            tasks.notify_question_report_async(report.id)
        by_chat = {
            c.kwargs["chat_id"]: c.kwargs.get("message_thread_id") for c in send.call_args_list
        }
        self.assertEqual(by_chat.get("-100grp"), 65)  # group -> topic 65
        self.assertIsNone(by_chat.get("555"))  # subscriber -> plain DM


@override_settings(QUESTION_REPORT_TELEGRAM_WEBHOOK_SECRET="sek", QUESTION_REPORT_TELEGRAM_BOT_TOKEN="")
class WebhookTests(TestCase):
    URL = "/api/question-reports/telegram/webhook/"

    def setUp(self):
        self.client = APIClient()  # DRF client understands format="json" (nested payload)

    def _update(self, text, chat_id="9001", username="tester"):
        return {
            "message": {
                "text": text,
                "chat": {"id": chat_id, "type": "private"},
                "from": {"username": username, "first_name": "Tess"},
            }
        }

    def test_bad_secret_is_403(self):
        r = self.client.post(
            self.URL, self._update("/start"), format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="wrong",
        )
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(TelegramReportSubscriber.objects.count(), 0)

    @override_settings(QUESTION_REPORT_TELEGRAM_WEBHOOK_SECRET="")
    def test_unconfigured_secret_fails_closed(self):
        # No secret configured -> webhook must reject (not silently accept /start).
        r = self.client.post(self.URL, self._update("/start"), format="json")
        self.assertEqual(r.status_code, 503, r.content)
        self.assertEqual(TelegramReportSubscriber.objects.count(), 0)

    def test_start_subscribes(self):
        r = self.client.post(
            self.URL, self._update("/start"), format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="sek",
        )
        self.assertEqual(r.status_code, 200, r.content)
        sub = TelegramReportSubscriber.objects.get(chat_id="9001")
        self.assertTrue(sub.is_active)
        self.assertEqual(sub.username, "tester")

    def test_start_with_botname_suffix(self):
        r = self.client.post(
            self.URL, self._update("/start@ReportBot"), format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="sek",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(TelegramReportSubscriber.objects.filter(chat_id="9001", is_active=True).exists())

    def test_stop_unsubscribes(self):
        TelegramReportSubscriber.objects.create(chat_id="9001", is_active=True)
        r = self.client.post(
            self.URL, self._update("/stop"), format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="sek",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(TelegramReportSubscriber.objects.get(chat_id="9001").is_active)


class EnqueueDispatchTests(TestCase):
    """The Telegram fan-out must never run inline in the request cycle (blocking HTTPS)."""

    def test_no_broker_defers_to_on_commit(self):
        from question_reports import tasks

        with patch.object(tasks, "notify_question_report_async") as task_mock:
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                tasks.enqueue_question_report_notification(report_id=123)
            # Deferred to on_commit, NOT executed inline in the request.
            task_mock.assert_not_called()
            task_mock.delay.assert_not_called()
            self.assertEqual(len(callbacks), 1)

    @override_settings(CELERY_BROKER_URL="redis://example:6379/0")
    def test_broker_uses_delay(self):
        from question_reports import tasks

        with patch.object(tasks, "notify_question_report_async") as task_mock:
            tasks.enqueue_question_report_notification(report_id=123)
            task_mock.delay.assert_called_once_with(123)


@override_settings(
    QUESTION_REPORT_TELEGRAM_WEBHOOK_SECRET="sek",
    QUESTION_REPORT_BOT_JOIN_CODE="letmein",
    QUESTION_REPORT_TELEGRAM_BOT_TOKEN="",
)
class WebhookJoinCodeTests(TestCase):
    URL = "/api/question-reports/telegram/webhook/"

    def setUp(self):
        self.client = APIClient()

    def _start(self, text):
        return {"message": {"text": text, "chat": {"id": "42"}, "from": {"username": "u"}}}

    def test_wrong_code_does_not_subscribe(self):
        r = self.client.post(
            self.URL, self._start("/start nope"), format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="sek",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(TelegramReportSubscriber.objects.filter(chat_id="42").exists())

    def test_correct_code_subscribes(self):
        r = self.client.post(
            self.URL, self._start("/start letmein"), format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="sek",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(TelegramReportSubscriber.objects.filter(chat_id="42", is_active=True).exists())


class KeyboardAndStatusTests(TestCase):
    """The Telegram message shows a status line and a status-appropriate inline button."""

    def _report(self, **kw):
        base = dict(
            id=5, system="exam", question_id=1,
            resource_type=QuestionErrorReport.RESOURCE_MIDTERM,
            resource_title="Unit 1", question_order=1, category="other",
            status=QuestionErrorReport.STATUS_NEW,
        )
        base.update(kw)
        return QuestionErrorReport(**base)  # unsaved is fine for the pure builders

    def test_not_fixed_shows_mark_fixed_button(self):
        from question_reports.targets import build_report_keyboard, build_report_message

        r = self._report()
        self.assertIn("Not fixed", build_report_message(r))
        kb = build_report_keyboard(r)
        self.assertEqual(kb["inline_keyboard"][0][0]["callback_data"], "qr:fix:5")
        self.assertIn("fixed", kb["inline_keyboard"][0][0]["text"].lower())

    def test_fixed_shows_status_label_and_reopen_button(self):
        from question_reports.targets import build_report_keyboard, build_report_message

        r = self._report(status=QuestionErrorReport.STATUS_FIXED, resolved_by_label="@admin")
        msg = build_report_message(r)
        self.assertIn("Fixed", msg)
        self.assertIn("@admin", msg)
        kb = build_report_keyboard(r)
        self.assertEqual(kb["inline_keyboard"][0][0]["callback_data"], "qr:reopen:5")


@override_settings(QUESTION_REPORT_TELEGRAM_WEBHOOK_SECRET="sek", QUESTION_REPORT_TELEGRAM_BOT_TOKEN="")
class WebhookCallbackTests(TestCase):
    """Inline 'Mark as fixed' / 'Reopen' taps update the DB + sync every posted copy."""

    URL = "/api/question-reports/telegram/webhook/"

    def setUp(self):
        self.client = APIClient()
        self.report = QuestionErrorReport.objects.create(
            system="exam", question_id=1,
            resource_type=QuestionErrorReport.RESOURCE_MIDTERM,
            resource_title="Unit 1", question_order=1, category="other",
            status=QuestionErrorReport.STATUS_NEW,
            telegram_messages=[
                {"chat_id": "-100group", "message_id": 10},
                {"chat_id": "555", "message_id": 20},
            ],
        )

    def _callback(self, data, username="adminx"):
        return {"callback_query": {"id": "cbq1", "data": data, "from": {"username": username}}}

    def _post(self, payload, secret="sek"):
        return self.client.post(
            self.URL, payload, format="json", HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=secret
        )

    def test_fix_marks_fixed_and_edits_all_copies(self):
        from question_reports import views

        with patch.object(views, "edit_telegram_message", return_value=True) as edit, \
             patch.object(views, "answer_callback_query", return_value=True) as ans:
            r = self._post(self._callback(f"qr:fix:{self.report.id}"))
        self.assertEqual(r.status_code, 200, r.content)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, QuestionErrorReport.STATUS_FIXED)
        self.assertEqual(self.report.resolved_by_label, "@adminx")
        edited = {c.kwargs["chat_id"]: c.kwargs["message_id"] for c in edit.call_args_list}
        self.assertEqual(edited, {"-100group": 10, "555": 20})
        self.assertIn("Fixed", edit.call_args_list[0].kwargs["text"])
        ans.assert_called_once()

    def test_reopen_clears_fixed(self):
        from question_reports import views

        self.report.status = QuestionErrorReport.STATUS_FIXED
        self.report.resolved_by_label = "@x"
        self.report.save()
        with patch.object(views, "edit_telegram_message", return_value=True), \
             patch.object(views, "answer_callback_query", return_value=True):
            r = self._post(self._callback(f"qr:reopen:{self.report.id}"))
        self.assertEqual(r.status_code, 200, r.content)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, QuestionErrorReport.STATUS_NEW)
        self.assertEqual(self.report.resolved_by_label, "")

    def test_unknown_report_answers_without_crash(self):
        from question_reports import views

        with patch.object(views, "answer_callback_query", return_value=True) as ans:
            r = self._post(self._callback("qr:fix:999999"))
        self.assertEqual(r.status_code, 200, r.content)
        ans.assert_called_once()

    def test_bad_secret_callback_is_403_and_no_change(self):
        r = self._post(self._callback(f"qr:fix:{self.report.id}"), secret="wrong")
        self.assertEqual(r.status_code, 403, r.content)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, QuestionErrorReport.STATUS_NEW)
