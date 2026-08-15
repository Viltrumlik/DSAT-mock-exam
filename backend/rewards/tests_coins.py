"""Coins: minted from points, monotonic, spendable, and never negative."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from rewards import coins as coins_service
from rewards import constants
from rewards.models import CoinTransaction, StudentWallet
from rewards.services import award, balance, current_season, revoke, start_new_season

User = get_user_model()


def _u(email, **kw):
    return User.objects.create_user(email, "secret123", **kw)


class MintingTests(TestCase):
    def setUp(self):
        self.student = _u("cn_s1@t.com")

    def _earn(self, points, key):
        award(self.student, constants.EVENT_MANUAL, idempotency_key=key, points=points)

    def test_points_mint_coins_at_the_seasons_rate(self):
        self._earn(25, "manual:1")
        self.assertEqual(coins_service.mint_owed(self.student), 2)   # 25 // 10
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 2)

    def test_minting_is_monotonic_and_never_pays_the_same_point_twice(self):
        self._earn(25, "manual:1")
        coins_service.mint_owed(self.student)
        for _ in range(3):
            self.assertEqual(coins_service.mint_owed(self.student), 0)

        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 2)

    def test_earning_more_mints_only_the_difference(self):
        self._earn(25, "manual:1")
        coins_service.mint_owed(self.student)
        self._earn(15, "manual:2")   # 40 total → 4 coins, 2 already minted

        self.assertEqual(coins_service.mint_owed(self.student), 2)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 4)

    def test_revoking_points_never_claws_coins_back(self):
        """The student may already have spent them. A wallet that goes negative because
        somebody fixed a register is not a wallet."""
        self._earn(30, "manual:1")
        coins_service.mint_owed(self.student)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)

        revoke("manual:1", reason="mark corrected")

        self.assertEqual(coins_service.mint_owed(self.student), 0)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)

    def test_minting_resumes_only_past_what_was_already_paid(self):
        self._earn(30, "manual:1")
        coins_service.mint_owed(self.student)      # 3 coins
        revoke("manual:1", reason="corrected")
        self._earn(25, "manual:2")                 # back to 25 points → worth 2, 3 already paid

        self.assertEqual(coins_service.mint_owed(self.student), 0)

        self._earn(20, "manual:3")                 # 45 points → worth 4
        self.assertEqual(coins_service.mint_owed(self.student), 1)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 4)

    def test_the_rate_is_a_season_policy(self):
        season = current_season()
        season.points_per_coin = 5
        season.save(update_fields=["points_per_coin"])
        self._earn(25, "manual:1")

        self.assertEqual(coins_service.mint_owed(self.student), 5)


class SeasonResetTests(TestCase):
    def setUp(self):
        self.student = _u("cn_season@t.com")

    def test_a_reset_zeroes_points_but_not_the_wallet(self):
        """Resetting the scoreboard is what the school asked for. Confiscating coins a
        student earned and has not spent would be taking something off them."""
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:1", points=30)
        coins_service.mint_owed(self.student)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)

        start_new_season("Season 2")

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)

    def test_the_new_season_mints_from_zero_rather_than_continuing(self):
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:1", points=30)
        coins_service.mint_owed(self.student)
        start_new_season("Season 2")

        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:2", points=20)

        # 20 points in the new season is worth 2 coins — the old season's mint does not count
        # against it, and the balance carries forward.
        self.assertEqual(coins_service.mint_owed(self.student), 2)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)


class SpendingTests(TestCase):
    def setUp(self):
        self.student = _u("cn_spend@t.com")
        self.staff = _u("cn_admin@t.com", role=C.ROLE_ADMIN)
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:1", points=50)
        coins_service.mint_owed(self.student)   # 5 coins

    def test_spending_reduces_coins_without_touching_points(self):
        coins_service.spend(self.student, 2, reference="Notebook", actor=self.staff)

        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 3)
        self.assertEqual(balance(self.student), 50)   # points are a score, not a currency

    def test_spending_more_than_the_balance_is_refused(self):
        with self.assertRaises(ValidationError):
            coins_service.spend(self.student, 99, reference="Bicycle", actor=self.staff)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)

    def test_a_spend_does_not_convert_unspent_points(self):
        """Conversion is manual, and a spend is not a request to convert.

        The inverse of what this used to assert. Minting inside `spend` would put automatic
        conversion back in through the back door — at the one moment a student is least
        likely to notice it happening.
        """
        award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:2", points=50)

        with self.assertRaises(ValidationError):
            coins_service.spend(self.student, 9, reference="Big prize", actor=self.staff)

        # The points are still there, still convertible, still theirs.
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)
        self.assertEqual(coins_service.convertible_coins(self.student), 5)

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

    def test_converting_is_what_mints(self):
        self.client.force_authenticate(self.student)
        body = self.client.post("/api/rewards/wallet/convert/").json()

        self.assertEqual(body["minted"], 4)
        self.assertEqual(body["coins"], 4)
        self.assertEqual(body["points"], 45)      # converting does not consume the score
        self.assertEqual(body["convertible_coins"], 0)

    def test_converting_twice_mints_once(self):
        """A double-tap or a retry must not pay twice — the amount owed is derived from what
        has already been minted, so the endpoint needs no idempotency key."""
        self.client.force_authenticate(self.student)
        self.client.post("/api/rewards/wallet/convert/")
        second = self.client.post("/api/rewards/wallet/convert/").json()

        self.assertEqual(second["minted"], 0)
        self.assertEqual(second["coins"], 4)

    def test_converting_below_the_rate_is_not_an_error(self):
        poor = _u("cn_poor@t.com")
        award(poor, constants.EVENT_MANUAL, idempotency_key="manual:poor", points=7)
        self.client.force_authenticate(poor)

        response = self.client.post("/api/rewards/wallet/convert/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["minted"], 0)
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
        self.assertEqual(body["points"], 45)
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
