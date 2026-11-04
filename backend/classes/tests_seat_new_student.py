from django.test import override_settings

from billing.models import Account, Entry
from classes import seat_actions as S
from classes.models import ClassroomMembership as M
from classes.tests_seat_actions import SeatCase, oct_
from lcup.accounts import PhoneTaken
from lcup.models import AccountClaim, LcupStudentLink
from users.models import User

PHONE = "998905550011"


class NewStudentTests(SeatCase):
    def make(self, status="trial", day=oct_(21), *, room=None, **fields):
        fields = {"full_name": "Karimova Malika", "phone": "+998 90 555 00 11", **fields}
        return S.new_student(room or self.room, status=status, day=day, today=day, by=self.boss, **fields)

    def new_user(self):
        return User.objects.get(username=PHONE)

    def test_a_trial_gets_an_account_and_a_seat_and_no_money(self):
        row = self.make("trial")
        user = self.new_user()
        self.assertEqual(row.user, user)
        self.assertEqual((user.phone_number, user.role), (PHONE, "student"))
        self.assertTrue(AccountClaim.objects.filter(user=user).exists())
        self.assertFalse(LcupStudentLink.objects.exists())
        self.assertEqual((row.status, row.seat_status), (M.STATUS_ACTIVE, M.SEAT_TRIAL))
        self.assertFalse(Entry.objects.exists())

    def test_an_active_seat_pays_from_the_date(self):
        self.make("active")
        self.assertEqual(self.balance(self.new_user()), -192_000)
        self.assertIsNone(Account.objects.get(user=self.new_user()).lcup_student_id)

    def test_the_parent_is_kept(self):
        self.make(parent_name=" Karim Karimov ", parent_phone="90 777 77 77")
        user = self.new_user()
        self.assertEqual((user.parent_name, user.parent_phone), ("Karim Karimov", "998907777777"))

    def test_a_parents_number_abroad_is_kept_as_typed(self):
        self.make(parent_phone="+7 916 123-45-67")
        self.assertEqual(self.new_user().parent_phone, "+79161234567")

    def test_a_parents_number_that_is_no_number_is_refused(self):
        with self.refused("Parent's phone"):
            self.make(parent_phone="call mum")
        self.assertFalse(User.objects.filter(username=PHONE).exists())

    def test_a_name_is_needed(self):
        with self.refused("full name"):
            self.make(full_name="   ")

    def test_a_phone_that_is_no_uzbek_number_is_refused(self):
        with self.refused("Uzbek"):
            self.make(phone="12345")

    def test_a_refused_seat_leaves_no_account_behind(self):
        free = self.make_room("Free", price=None)
        with self.refused("no monthly price"):
            self.make("active", room=free)
        self.assertFalse(User.objects.filter(username=PHONE).exists())

    def test_a_refused_seat_leaves_a_public_accounts_phone_where_it_was(self):
        free = self.make_room("Free", price=None)
        old = User.objects.create_user(None, password="x", username="old", role="public_student", phone_number=PHONE)
        with self.refused("no monthly price"):
            self.make("active", room=free)
        old.refresh_from_db()
        self.assertEqual(old.phone_number, PHONE)

    def test_a_public_accounts_phone_moves_and_the_new_account_gets_the_seat(self):
        old = User.objects.create_user(None, password="x", username="old", role="public_student", phone_number=PHONE)
        row = self.make("trial")
        old.refresh_from_db()
        self.assertIsNone(old.phone_number)
        self.assertEqual(old.role, "public_student")
        self.assertEqual(row.user, self.new_user())
        self.assertFalse(M.objects.filter(user=old).exists())

    def test_a_centre_account_on_the_phone_stops_it_and_says_whose(self):
        old = User.objects.create_user(None, password="x", username="sib", role="student", phone_number=PHONE)
        with self.assertRaises(PhoneTaken) as caught:
            self.make("trial")
        self.assertEqual(caught.exception.account, old)
        self.assertFalse(M.objects.filter(classroom=self.room, user=old).exists())

    @override_settings(LCUP_ENABLED=True)
    def test_it_is_refused_whenever_lc_up_is_on(self):
        with self.assertRaises(S.SeatsLocked):
            self.make("trial")
        self.assertFalse(User.objects.filter(username=PHONE).exists())
