"""Coins: BOUGHT with points, spendable, and never negative.

The load-bearing change these tests pin is that conversion now costs. Points used to be a
lifetime score that coins were derived from — the same point could mint a coin and stay on
the scoreboard forever. It is a purchase now, so the whole of `MintingTests` below is about
the balance going DOWN by exactly what the coins cost, and not by a point more.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from rewards import coins as coins_service
from rewards import constants
from rewards.models import CoinTransaction, PointAward, StudentWallet
from rewards.services import (
    award, balance, current_season, revoke, start_new_season, xp_balance,
)

User = get_user_model()


def _u(email, **kw):
    return User.objects.create_user(email, "secret123", **kw)


class MintingTests(TestCase):
    """Buying coins with points. The rule: the balance falls by exactly what was spent."""

    def setUp(self):
        self.student = _u("cn_s1@t.com")

    def _earn(self, points, key):
        award(self.student, constants.EVENT_MANUAL, idempotency_key=key, points=points)

    def test_converting_buys_coins_and_takes_the_points(self):
        self._earn(25, "manual:1")

        result = coins_service.convert(self.student, 20)

        self.assertEqual(result, {"coins": 2, "points_spent": 20})
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 2)
        self.assertEqual(balance(self.student), 5)   # 25 - 20, and the 5 stays

    def test_max_spends_only_what_buys_whole_coins(self):
        """34 points at 10-a-coin buys 3 and costs 30. Charging for the 4 nobody got back
        would be the one thing a student would never forgive."""
        self._earn(34, "manual:1")

        result = coins_service.convert(self.student)   # None = Max

        self.assertEqual(result, {"coins": 3, "points_spent": 30})
        self.assertEqual(balance(self.student), 4)

    def test_converting_twice_spends_twice(self):
        """The old conversion was idempotent because it derived what it owed. A purchase is
        not, and must not be: a student may cash in twice."""
        self._earn(50, "manual:1")

        coins_service.convert(self.student, 20)
        coins_service.convert(self.student, 20)

        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 4)
        self.assertEqual(balance(self.student), 10)

    def test_converting_everything_leaves_nothing_to_convert(self):
        self._earn(40, "manual:1")
        coins_service.convert(self.student)

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(coins_service.convertible_coins(self.student), 0)
        # A second Max is a no-op rather than an error — there is simply nothing to spend.
        self.assertEqual(coins_service.convert(self.student), {"coins": 0, "points_spent": 0})
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 4)

    def test_asking_for_more_points_than_you_have_is_refused(self):
        """Refused, not clamped. A student who typed 400 and got 4 coins would read the
        balance as broken."""
        self._earn(25, "manual:1")

        with self.assertRaises(ValidationError):
            coins_service.convert(self.student, 400)

        self.assertEqual(balance(self.student), 25)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 0)

    def test_a_negative_amount_is_refused(self):
        self._earn(25, "manual:1")
        with self.assertRaises(ValidationError):
            coins_service.convert(self.student, -5)
        self.assertEqual(balance(self.student), 25)

    def test_converting_below_the_rate_costs_nothing(self):
        self._earn(7, "manual:1")

        self.assertEqual(coins_service.convert(self.student, 7), {"coins": 0, "points_spent": 0})
        self.assertEqual(balance(self.student), 7)   # untouched, not swallowed

    def test_xp_does_not_fall_when_points_are_spent(self):
        """The whole reason the leaderboard ranks on XP: spending must never cost a student
        their place on it."""
        self._earn(40, "manual:1")
        before = xp_balance(self.student)

        coins_service.convert(self.student)

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(xp_balance(self.student), before)
        self.assertGreater(before, 0)   # the test would pass vacuously if XP were never earned

    def test_the_spend_is_recorded_on_both_sides(self):
        """The coin row says what it cost; the point ledger says where the points went."""
        self._earn(30, "manual:1")
        coins_service.convert(self.student, 30)

        tx = CoinTransaction.objects.get(kind=CoinTransaction.KIND_EARN)
        self.assertEqual(tx.amount, 3)
        self.assertEqual(tx.points_spent, 30)

        debit = PointAward.objects.get(event=constants.EVENT_COIN_CONVERSION)
        self.assertEqual(debit.points, -30)
        self.assertEqual(debit.xp, 0)
        self.assertEqual(debit.idempotency_key, f"coin-conversion:{tx.pk}")

    def test_revoking_points_after_a_conversion_never_claws_coins_back(self):
        """The student may already have spent them. A wallet that goes negative because
        somebody fixed a register is not a wallet."""
        self._earn(30, "manual:1")
        coins_service.convert(self.student, 30)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)

        revoke("manual:1", reason="mark corrected")

        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)
        self.assertEqual(coins_service.convertible_coins(self.student), 0)

    def test_the_rate_is_a_season_policy(self):
        season = current_season()
        season.points_per_coin = 5
        season.save(update_fields=["points_per_coin"])
        self._earn(25, "manual:1")

        self.assertEqual(coins_service.convert(self.student), {"coins": 5, "points_spent": 25})


class SeasonResetTests(TestCase):
    def setUp(self):
        self.student = _u("cn_season@t.com")

    def test_a_reset_zeroes_points_but_not_the_wallet(self):
        """Resetting the scoreboard is what the school asked for. Confiscating coins a
        student earned and has not spent would be taking something off them."""
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:1", points=30)
        coins_service.convert(self.student)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)

        start_new_season("Season 2")

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)

    def test_the_new_season_starts_from_zero_rather_than_continuing(self):
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:1", points=30)
        coins_service.convert(self.student)
        start_new_season("Season 2")

        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:2", points=20)

        # 20 points in the new season buys 2 coins, and the coin balance carries forward.
        self.assertEqual(coins_service.convert(self.student), {"coins": 2, "points_spent": 20})
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)


class SpendingTests(TestCase):
    def setUp(self):
        self.student = _u("cn_spend@t.com")
        self.staff = _u("cn_admin@t.com", role=C.ROLE_ADMIN)
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:1", points=50)
        coins_service.convert(self.student)   # 5 coins, and the 50 points are spent

    def test_spending_reduces_coins_and_does_not_refund_points(self):
        coins_service.spend(self.student, 2, reference="Notebook", actor=self.staff)

        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)
        # The points went when the coins were bought. Buying a notebook does not give them
        # back, and does not take any more either.
        self.assertEqual(balance(self.student), 0)

    def test_spending_more_than_the_balance_is_refused(self):
        with self.assertRaises(ValidationError):
            coins_service.spend(self.student, 99, reference="Bicycle", actor=self.staff)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)

    def test_a_spend_does_not_convert_unspent_points(self):
        """Conversion is manual, and a spend is not a request to convert.

        Converting inside `spend` would put automatic conversion back in through the back
        door — and now that converting COSTS points, it would take them at the one moment a
        student is least likely to notice.
        """
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:2", points=50)

        with self.assertRaises(ValidationError):
            coins_service.spend(self.student, 9, reference="Big prize", actor=self.staff)

        # The points are still there, still convertible, still theirs.
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)
        self.assertEqual(coins_service.convertible_coins(self.student), 5)
        self.assertEqual(balance(self.student), 50)

    def test_the_ledger_and_the_cached_balance_agree(self):
        coins_service.spend(self.student, 2, reference="Notebook", actor=self.staff)
        coins_service.adjust(self.student, 4, reason="Prize", actor=self.staff)

        wallet = coins_service.wallet_for(self.student)
        from django.db.models import Sum
        ledger = CoinTransaction.objects.filter(wallet=wallet).aggregate(t=Sum("amount"))["t"]
        self.assertEqual(wallet.coins_balance, ledger)

    def test_an_admin_revocation_cannot_push_a_wallet_negative(self):
        coins_service.adjust(self.student, -99, reason="Mistake", actor=self.staff)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 0)

    def test_revoking_from_an_empty_wallet_is_refused(self):
        coins_service.adjust(self.student, -5, reason="All of it", actor=self.staff)
        with self.assertRaises(ValidationError):
            coins_service.adjust(self.student, -1, reason="More", actor=self.staff)

    def test_a_zero_or_negative_spend_is_refused(self):
        for bad in (0, -3):
            with self.assertRaises(ValidationError):
                coins_service.spend(self.student, bad, reference="Nothing", actor=self.staff)


class WalletApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = _u("cn_api@t.com")
        self.other = _u("cn_other@t.com")
        self.staff = _u("cn_apiadmin@t.com", role=C.ROLE_ADMIN)
        self.teacher = _u("cn_teacher@t.com", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:1", points=45)

    def test_the_wallet_endpoint_does_not_mint_on_read(self):
        """Reading a wallet is not converting. It reports what could be converted instead."""
        self.client.force_authenticate(self.student)
        body = self.client.get("/api/rewards/wallet/").json()

        self.assertEqual(body["coins"], 0)
        self.assertEqual(body["points"], 45)
        self.assertEqual(body["convertible_coins"], 4)
        self.assertEqual(body["points_to_next_coin"], 5)

    def test_an_empty_body_means_max(self):
        """POST with no amount buys everything that adds up to a whole coin — the Max press."""
        self.client.force_authenticate(self.student)
        body = self.client.post("/api/rewards/wallet/convert/").json()

        self.assertEqual(body["minted"], 4)
        self.assertEqual(body["coins"], 4)
        self.assertEqual(body["points_spent"], 40)
        self.assertEqual(body["points"], 5)       # 45 - 40; the change stays
        self.assertEqual(body["convertible_coins"], 0)

    def test_an_amount_converts_only_that_much(self):
        self.client.force_authenticate(self.student)
        body = self.client.post(
            "/api/rewards/wallet/convert/", {"points": 20}, format="json"
        ).json()

        self.assertEqual(body["minted"], 2)
        self.assertEqual(body["points_spent"], 20)
        self.assertEqual(body["points"], 25)
        self.assertEqual(body["convertible_coins"], 2)   # still 25 left to spend

    def test_asking_for_more_than_you_have_is_a_400_not_a_clamp(self):
        self.client.force_authenticate(self.student)
        response = self.client.post(
            "/api/rewards/wallet/convert/", {"points": 4000}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("45", response.json()["detail"])
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 0)

    def test_converting_twice_spends_twice(self):
        """Not idempotent, and it must not be: a student may cash in more than once."""
        self.client.force_authenticate(self.student)
        self.client.post("/api/rewards/wallet/convert/", {"points": 20}, format="json")
        second = self.client.post(
            "/api/rewards/wallet/convert/", {"points": 20}, format="json"
        ).json()

        self.assertEqual(second["minted"], 2)
        self.assertEqual(second["coins"], 4)
        self.assertEqual(second["points"], 5)

    def test_converting_below_the_rate_is_not_an_error(self):
        poor = _u("cn_poor@t.com")
        award(poor, constants.EVENT_MANUAL, idempotency_key="manual:poor", points=7)
        self.client.force_authenticate(poor)

        response = self.client.post("/api/rewards/wallet/convert/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["minted"], 0)
        self.assertEqual(response.json()["points"], 7)   # nothing taken
        self.assertIn("3 more", response.json()["detail"])

    def test_a_student_cannot_convert_for_somebody_else(self):
        """There is no route that takes a student id — conversion is always the caller's own
        wallet, so this is a route-shape guarantee rather than a permission check."""
        self.client.force_authenticate(self.other)
        self.client.post("/api/rewards/wallet/convert/")

        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 0)

    def test_the_wallet_never_names_the_season(self):
        """Both wallet endpoints spread `wallet_state()`, so one leak there would surface in
        two places. See the matching test on /api/rewards/me/."""
        self.client.force_authenticate(self.student)
        self.assertNotIn("season", self.client.get("/api/rewards/wallet/").json())

        self.client.force_authenticate(self.staff)
        body = self.client.get(f"/api/rewards/wallet/{self.student.id}/").json()
        self.assertNotIn("season", body)
        self.assertNotIn("season", str(body["transactions"]))

    def test_the_points_page_reports_the_wallet_not_a_derived_figure(self):
        """Once coins are spendable the two diverge, and a derived figure would keep showing
        a student coins they have already spent."""
        self.client.force_authenticate(self.student)
        self.client.post("/api/rewards/wallet/convert/")
        coins_service.spend(self.student, 4, reference="Prize", actor=self.staff)

        body = self.client.get("/api/rewards/me/").json()
        # 45 earned, 40 spent buying the coins, and the coins then spent on a prize. Both
        # numbers moved, and /me/ and /wallet/ agree because both read the same ledger.
        self.assertEqual(body["points"], 5)
        self.assertEqual(body["coins"], 0)

    def test_staff_can_record_a_spend(self):
        coins_service.convert(self.student)      # 45 points → 4 coins
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            f"/api/rewards/wallet/{self.student.id}/",
            {"action": "spend", "amount": 2, "reference": "Notebook"}, format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["balance_after"], 2)

    def test_staff_cannot_spend_points_the_student_never_converted(self):
        """The desk cannot reach into unconverted points. `action=convert` is the way out."""
        self.client.force_authenticate(self.staff)
        refused = self.client.post(
            f"/api/rewards/wallet/{self.student.id}/",
            {"action": "spend", "amount": 2, "reference": "Notebook"}, format="json",
        )
        self.assertEqual(refused.status_code, 400)

        self.client.post(
            f"/api/rewards/wallet/{self.student.id}/", {"action": "convert"}, format="json",
        )
        allowed = self.client.post(
            f"/api/rewards/wallet/{self.student.id}/",
            {"action": "spend", "amount": 2, "reference": "Notebook"}, format="json",
        )
        self.assertEqual(allowed.status_code, 201)

    def test_a_teacher_cannot_convert_a_students_points(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.post(
            f"/api/rewards/wallet/{self.student.id}/", {"action": "convert"}, format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 0)

    def test_a_spend_must_say_what_it_was_for(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            f"/api/rewards/wallet/{self.student.id}/",
            {"action": "spend", "amount": 2, "reference": "  "}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_a_teacher_cannot_move_a_students_coins(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.post(
            f"/api/rewards/wallet/{self.student.id}/",
            {"action": "spend", "amount": 1, "reference": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_a_student_cannot_move_their_own_coins(self):
        self.client.force_authenticate(self.student)
        response = self.client.post(
            f"/api/rewards/wallet/{self.student.id}/",
            {"action": "spend", "amount": 1, "reference": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_a_student_cannot_read_another_students_wallet(self):
        self.client.force_authenticate(self.other)
        response = self.client.get(f"/api/rewards/wallet/{self.student.id}/")
        self.assertEqual(response.status_code, 403)

    def test_the_history_shows_what_each_movement_was_for(self):
        self.client.force_authenticate(self.student)
        self.client.post("/api/rewards/wallet/convert/")
        coins_service.spend(self.student, 1, reference="Sticker pack", actor=self.staff)

        body = self.client.get("/api/rewards/wallet/").json()
        kinds = {t["kind"]: t for t in body["transactions"]}
        self.assertEqual(kinds["SPEND"]["reference"], "Sticker pack")
        self.assertEqual(kinds["SPEND"]["amount"], -1)
        self.assertIn("EARN", kinds)


class WalletIsCreatedOnDemandTests(TestCase):
    def test_a_student_with_no_wallet_reads_as_zero(self):
        student = _u("cn_fresh@t.com")
        self.assertEqual(StudentWallet.objects.count(), 0)

        state = coins_service.wallet_state(student)

        self.assertEqual(state["coins"], 0)
        self.assertEqual(StudentWallet.objects.count(), 1)
