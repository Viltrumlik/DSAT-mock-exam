"""Guard on the 0025 data step that took a production deploy down.

`telegram_id` is a bigint. One legacy synthetic address carries a 20-digit id that never
fit the column (hence its telegram_id is already NULL), and feeding it to a queryset made
Postgres raise `bigint out of range` mid-migration — rolling the whole deploy back.

SQLite does not enforce the bigint range, so this cannot reproduce the *crash* here; what
it pins is the *behaviour* that avoids it — an unstorable id is skipped, the row is still
nulled, and a recoverable id on a normal row still round-trips. Remove the guard and the
overflow row's telegram_id gets written, failing the first assertion.
"""
from __future__ import annotations

import importlib

from django.apps import apps
from django.contrib.auth import get_user_model
from django.test import TestCase

User = get_user_model()

_migration = importlib.import_module("users.migrations.0025_email_nullable")
BIGINT_MAX = _migration.BIGINT_MAX


class DropPlaceholderAddressesTests(TestCase):
    def _run(self):
        _migration.drop_placeholder_addresses(apps, None)

    def test_recoverable_id_is_written_and_address_nulled(self):
        u = User.objects.create(
            username="normaltg", email="tg777001@telegram.mastersat.local", telegram_id=None
        )
        self._run()
        u.refresh_from_db()
        self.assertEqual(u.telegram_id, 777001)
        self.assertIsNone(u.email)

    def test_overflow_id_is_skipped_not_crashed(self):
        # pk-182 shape: 20-digit id, above bigint, telegram_id already NULL.
        overflow = "12615110688574587245"
        self.assertGreater(int(overflow), BIGINT_MAX)
        u = User.objects.create(
            username="jayunxx",
            email=f"tg{overflow}@telegram.mastersat.local",
            telegram_id=None,
        )
        self._run()
        u.refresh_from_db()
        self.assertIsNone(u.telegram_id, "an unstorable id must not be written")
        self.assertIsNone(u.email, "the address is still nulled like every synthetic row")
        self.assertEqual(u.username, "jayunxx", "the username that keeps them reachable")

    def test_recovery_does_not_collide_with_an_existing_id(self):
        User.objects.create(username="holder", email="real@x.uz", telegram_id=42)
        u = User.objects.create(
            username="dup", email="tg42@telegram.mastersat.local", telegram_id=None
        )
        self._run()
        u.refresh_from_db()
        # 42 is taken, so recovery is declined; the address is still cleared.
        self.assertIsNone(u.telegram_id)
        self.assertIsNone(u.email)
