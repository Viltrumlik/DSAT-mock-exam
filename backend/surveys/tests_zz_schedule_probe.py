"""TEMP PROBE — delete after running. Can a survey be scheduled to open/close today?"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from surveys import services
from surveys.models import Survey, SurveyQuestion

User = get_user_model()


class ScheduleProbe(TestCase):
    def setUp(self):
        self.super_admin = User.objects.create_user(
            "probe_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN
        )
        self.student = User.objects.create_user("probe_student@t.com", "secret123")

    # ── Route 1: the REST API the console itself talks to ──────────────────
    def test_api_accepts_opens_at_and_the_window_is_honoured(self):
        api = APIClient()
        api.force_authenticate(self.super_admin)
        created = api.post("/api/surveys/admin/", {"title": "End of term"}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        sid = created.json()["id"]
        q = api.post(
            f"/api/surveys/admin/{sid}/questions/",
            {"prompt": "How was the term?", "question_type": "LONG_TEXT"},
            format="json",
        )
        self.assertEqual(q.status_code, 201, q.content)

        now = timezone.localtime(timezone.now())
        opens = (now + timedelta(days=3)).replace(hour=9, minute=0, second=0, microsecond=0)
        closes = (now + timedelta(days=7)).replace(hour=18, minute=0, second=0, microsecond=0)

        patched = api.patch(
            f"/api/surveys/admin/{sid}/",
            {
                "status": "PUBLISHED",
                "opens_at": opens.isoformat(),
                "closes_at": closes.isoformat(),
            },
            format="json",
        )
        self.assertEqual(patched.status_code, 200, patched.content)

        s = Survey.objects.get(pk=sid)
        self.assertEqual(s.status, "PUBLISHED")
        self.assertEqual(timezone.localtime(s.opens_at), opens)
        self.assertEqual(timezone.localtime(s.closes_at), closes)

        # Published on Friday, but shut until Monday 09:00.
        self.assertFalse(s.is_open())
        self.assertEqual(list(services.open_surveys_for(self.student)), [])
        sc = APIClient()
        sc.force_authenticate(self.student)
        self.assertEqual(sc.get(f"/api/surveys/{sid}/").status_code, 404)
        self.assertEqual(sc.get("/api/surveys/open/").json()["surveys"], [])

        # The window opens and shuts on its own, to the second, no keyboard involved.
        self.assertFalse(s.is_open(now=opens - timedelta(seconds=1)))
        self.assertTrue(s.is_open(now=opens + timedelta(seconds=1)))
        self.assertTrue(s.is_open(now=closes - timedelta(seconds=1)))
        self.assertFalse(s.is_open(now=closes + timedelta(seconds=1)))

        # And the student's list flips with it (opens_at now in the past).
        Survey.objects.filter(pk=sid).update(opens_at=now - timedelta(minutes=1))
        self.assertEqual([x.id for x in services.open_surveys_for(self.student)], [sid])
        listed = sc.get("/api/surveys/open/").json()["surveys"]
        self.assertEqual([x["id"] for x in listed], [sid])

    # ── Route 2: the /django-admin/ change form, a real UI ─────────────────
    def test_django_admin_change_form_writes_an_exact_open_and_close_time(self):
        staff = User.objects.create_user(
            "probe_staff@t.com", "secret123", role=C.ROLE_SUPER_ADMIN
        )
        User.objects.filter(pk=staff.pk).update(is_staff=True, is_superuser=True)
        staff.refresh_from_db()

        survey = Survey.objects.create(title="End of term", status=Survey.STATUS_DRAFT)

        c = Client()
        c.force_login(staff)
        url = f"/django-admin/surveys/survey/{survey.id}/change/"
        page = c.get(url)
        self.assertEqual(page.status_code, 200)
        html = page.content.decode()
        self.assertIn('name="opens_at_0"', html)   # date half
        self.assertIn('name="opens_at_1"', html)   # TIME half
        self.assertIn('name="closes_at_0"', html)
        self.assertIn('name="closes_at_1"', html)

        posted = c.post(
            url,
            {
                "title": "End of term",
                "description": "",
                "status": "PUBLISHED",
                "opens_at_0": "2026-09-07",
                "opens_at_1": "09:00:00",
                "closes_at_0": "2026-09-11",
                "closes_at_1": "18:00:00",
                "questions-TOTAL_FORMS": "0",
                "questions-INITIAL_FORMS": "0",
                "questions-MIN_NUM_FORMS": "0",
                "questions-MAX_NUM_FORMS": "1000",
                "_save": "Save",
            },
            follow=True,
        )
        self.assertEqual(posted.status_code, 200)
        survey.refresh_from_db()
        self.assertEqual(survey.status, "PUBLISHED")
        self.assertIsNotNone(survey.opens_at)
        self.assertEqual(
            timezone.localtime(survey.opens_at).strftime("%Y-%m-%d %H:%M"), "2026-09-07 09:00"
        )
        self.assertEqual(
            timezone.localtime(survey.closes_at).strftime("%Y-%m-%d %H:%M"), "2026-09-11 18:00"
        )
        SurveyQuestion.objects.create(
            survey=survey, order=0, prompt="How was it?", question_type="LONG_TEXT"
        )
        self.assertFalse(survey.is_open(now=timezone.make_aware(
            timezone.datetime(2026, 9, 7, 8, 59))))
        self.assertTrue(survey.is_open(now=timezone.make_aware(
            timezone.datetime(2026, 9, 7, 9, 1))))
        self.assertFalse(survey.is_open(now=timezone.make_aware(
            timezone.datetime(2026, 9, 11, 18, 1))))
