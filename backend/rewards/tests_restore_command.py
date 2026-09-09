"""`restore_revoked_awards` — giving back what a revocation took by mistake.

The dangerous failure is not "restored too little". It is restoring the *wrong* revocation:
this database carries a deliberate integrity sweep from 2026-08-27 that removed 561 XP of
attendance marked for lessons students had never joined, and putting those back would undo the
cleanup. Most of these tests exist to pin the scoping.
"""

from __future__ import annotations

from datetime import datetime
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import TestCase
from django.utils import timezone

from rewards.models import PointAward, PointAwardAudit
from rewards.services import balance, current_season, revoke, xp_balance

User = get_user_model()

WRONGLY = "attendance record deleted"
RIGHTLY = "attendance corrected to ABSENT"


class RestoreRevokedAwardsTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user("rs_student@t.com", "secret123")

    def _award(self, key, points=5, xp=5):
        return PointAward.objects.create(
            student=self.student, season=current_season(), event="MANUAL",
            points=points, xp=xp, idempotency_key=key,
        )

    def _revoke_at(self, key, *, reason, when):
        revoke(key, reason=reason)
        row = PointAwardAudit.objects.filter(award__idempotency_key=key).order_by("-id").first()
        PointAwardAudit.objects.filter(pk=row.pk).update(
            created_at=timezone.make_aware(datetime.fromisoformat(when))
        )
        return row

    def _run(self, *, reason=WRONGLY, since="2026-08-26", until="2026-08-27", apply=False):
        out = StringIO()
        args = ["restore_revoked_awards", "--reason", reason, "--since", since, "--until", until]
        if apply:
            args.append("--apply")
        call_command(*args, stdout=out)
        return out.getvalue()

    def test_it_gives_back_exactly_what_was_taken(self):
        self._award("a1")
        self._revoke_at("a1", reason=WRONGLY, when="2026-08-26T06:20:24")
        self.assertEqual((balance(self.student), xp_balance(self.student)), (0, 0))

        self._run(apply=True)

        self.assertEqual((balance(self.student), xp_balance(self.student)), (5, 5))

    def test_the_restore_is_written_into_the_history(self):
        """"Why did my XP come back?" has to be answerable from the ledger alone — the same
        rule `services.revoke` follows on the way down."""
        self._award("a1")
        self._revoke_at("a1", reason=WRONGLY, when="2026-08-26T06:20:24")

        self._run(apply=True)

        latest = PointAwardAudit.objects.order_by("-id").first()
        self.assertEqual((latest.previous_points, latest.new_points), (0, 5))
        self.assertEqual((latest.previous_xp, latest.new_xp), (0, 5))
        self.assertIn("restored", latest.reason)

    def test_a_report_writes_nothing(self):
        self._award("a1")
        self._revoke_at("a1", reason=WRONGLY, when="2026-08-26T06:20:24")

        output = self._run()

        self.assertEqual(balance(self.student), 0)
        self.assertIn("Would restore", output)

    def test_a_revocation_outside_the_window_is_left_alone(self):
        """The 2026-08-27 integrity sweep. Same reason string, different day, and it was
        correct — restoring it would put back attendance for lessons nobody attended."""
        self._award("sweep")
        self._revoke_at("sweep", reason=WRONGLY, when="2026-08-27T04:52:00")

        self._run(apply=True)

        self.assertEqual(balance(self.student), 0)

    def test_a_different_reason_is_left_alone(self):
        self._award("corrected")
        self._revoke_at("corrected", reason=RIGHTLY, when="2026-08-26T06:20:24")

        self._run(apply=True)

        self.assertEqual(balance(self.student), 0)

    def test_running_twice_restores_nothing_the_second_time(self):
        self._award("a1")
        self._revoke_at("a1", reason=WRONGLY, when="2026-08-26T06:20:24")
        self._run(apply=True)

        before = PointAwardAudit.objects.count()
        output = self._run(apply=True)

        self.assertEqual((balance(self.student), xp_balance(self.student)), (5, 5))
        self.assertEqual(PointAwardAudit.objects.count(), before)
        self.assertIn("skip", output)

    def test_an_award_earned_again_since_is_not_topped_up(self):
        """If something re-paid this award after the revocation, its current value is the
        truth. Adding the old figure on top would pay for one lesson twice."""
        self._award("a1")
        self._revoke_at("a1", reason=WRONGLY, when="2026-08-26T06:20:24")
        PointAward.objects.filter(idempotency_key="a1").update(points=3, xp=3)

        self._run(apply=True)

        self.assertEqual((balance(self.student), xp_balance(self.student)), (3, 3))

    def test_a_backwards_window_is_refused(self):
        with self.assertRaises(CommandError):
            self._run(since="2026-08-27", until="2026-08-26", apply=True)
