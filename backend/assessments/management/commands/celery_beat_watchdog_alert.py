"""
The alerting half of the celery beat watchdog (deploy/watchdog/sat_beat_watchdog.py).

The watchdog runs as root outside the app, stdlib only, so that it still works when a release
is broken. What it has to say it hands to this command — as satapp, one JSON event on stdin —
so the alert travels the same road as the assessments SLO alerts: a CRITICAL log line, the ops
webhook or email when configured, and a SecurityAlert row in the admin.

`source` is "watchdog", which is not one of SecurityAlert.SOURCE_CHOICES on purpose: choices are
not enforced on create, and adding one costs a migration for no change in the table. Find these
rows in the admin by alert_type, which starts with "celery_beat.".
"""

from __future__ import annotations

import json
import re
import sys

from django.core.management.base import BaseCommand, CommandError

from assessments.ops_alerts import deliver_ops_alert

SOURCE = "watchdog"
EVENT_RE = re.compile(r"^[a-z_]{1,40}$")


class Command(BaseCommand):
    help = "Deliver one celery beat watchdog event (a JSON object on stdin) through deliver_ops_alert."

    def add_arguments(self, parser):
        parser.add_argument("--payload", help="The event as JSON, instead of reading it from stdin.")

    def handle(self, *args, **options):
        raw = options.get("payload")
        if raw is None:
            raw = sys.stdin.read()
        try:
            event = json.loads(raw)
        except ValueError as exc:
            raise CommandError(f"payload is not JSON: {exc}") from exc
        if not isinstance(event, dict):
            raise CommandError("payload must be a JSON object")
        name = str(event.get("event") or "")
        if not EVENT_RE.match(name):
            raise CommandError(f"bad event name: {name[:60]!r}")

        alert_type = f"celery_beat.{name}"
        payload = {**event, "type": alert_type}
        # One row per incident; events with no incident (budget exhausted, PM2 down) are already
        # rate-limited by the watchdog's own cooldown.
        fingerprint = f"{alert_type}:{event.get('incident') or ''}"
        delivery = deliver_ops_alert(
            payload=payload,
            fingerprint=fingerprint,
            source=SOURCE,
            alert_type=alert_type,
        )
        self.stdout.write(json.dumps(delivery, sort_keys=True, default=str))
