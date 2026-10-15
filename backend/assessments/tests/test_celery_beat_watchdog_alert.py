"""celery_beat_watchdog_alert: the beat watchdog's events reach the ops alerting and the admin."""
from __future__ import annotations

import io
import json
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from assessments.models import SecurityAlert

EVENT = {
    "event": "stalled_restarted",
    "host": "Ubuntu-2404-noble-amd64-base",
    "incident": "/var/lib/sat-beat-watchdog/incidents/20261015-064730",
    "log_age_s": 612,
    "schedule_age_s": 640,
    "signature": "redis-py PubSub self-deadlock (redis/redis-py#3640)",
}

NO_CHANNELS = dict(ASSESSMENT_OPS_WEBHOOK_URL="", CLASSROOM_OPS_WEBHOOK_URL="", CLASSROOM_OPS_EMAIL_RECIPIENTS="")


def run(**kwargs) -> dict:
    out = io.StringIO()
    call_command("celery_beat_watchdog_alert", stdout=out, **kwargs)
    return json.loads(out.getvalue())


@override_settings(**NO_CHANNELS)
class CeleryBeatWatchdogAlertTests(TestCase):
    def test_persists_a_security_alert_row(self):
        delivery = run(payload=json.dumps(EVENT))

        row = SecurityAlert.objects.get()
        self.assertEqual(row.alert_type, "celery_beat.stalled_restarted")
        self.assertEqual(row.source, "watchdog")
        self.assertEqual(row.fingerprint, f"celery_beat.stalled_restarted:{EVENT['incident']}")
        self.assertEqual(row.payload["type"], "celery_beat.stalled_restarted")
        self.assertEqual(row.payload["log_age_s"], 612)
        self.assertEqual(delivery["alert_row_id"], row.pk)
        self.assertFalse(delivery["webhook_configured"])

    def test_logs_critical(self):
        with self.assertLogs("ops.assessments", level="CRITICAL") as logs:
            run(payload=json.dumps(EVENT))
        self.assertIn("celery_beat.stalled_restarted", logs.output[0])

    def test_reads_the_event_from_stdin(self):
        with mock.patch("sys.stdin", io.StringIO(json.dumps({"event": "recovered"}))):
            run()
        self.assertEqual(SecurityAlert.objects.get().alert_type, "celery_beat.recovered")

    @override_settings(ASSESSMENT_OPS_WEBHOOK_URL="https://hooks.example.test/ops")
    def test_posts_to_the_ops_webhook_when_one_is_configured(self):
        with mock.patch("requests.post", return_value=mock.Mock(status_code=200)) as post:
            delivery = run(payload=json.dumps(EVENT))
        self.assertTrue(delivery["webhook_ok"])
        self.assertEqual(post.call_args.args[0], "https://hooks.example.test/ops")
        self.assertEqual(post.call_args.kwargs["json"]["type"], "celery_beat.stalled_restarted")
        self.assertTrue(SecurityAlert.objects.get().webhook_delivered)

    def test_refuses_what_is_not_an_event(self):
        for bad in ("not json", "[1, 2]", json.dumps({"event": "Bad Name"}), json.dumps({})):
            with self.subTest(bad=bad), self.assertRaises(CommandError):
                run(payload=bad)
        self.assertFalse(SecurityAlert.objects.exists())
