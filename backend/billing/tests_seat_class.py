from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase

from billing import shadow
from billing.models import Account, Seat
from billing.tests_ledger import make_seat
from billing.tests_shadow import NOW, Fixture, Opened
from classes.models import Classroom
from lcup.models import GroupLinkStatus, LcupGroupLink

User = get_user_model()


def make_room(name="Junior G1"):
    owner = User.objects.create_user(None, password=None, username=f"owner-{name}", role="teacher", subject="math")
    return Classroom.objects.create(name=name, subject=Classroom.SUBJECT_MATH, lesson_days="ODD", teacher=owner, created_by=owner)


def pair(group, room):
    LcupGroupLink.objects.filter(pk=group.pk).update(classroom=room, status=GroupLinkStatus.CONFIRMED)


class SeatClassCase(Fixture):
    def setUp(self):
        self.room = make_room()
        self.healthy_sync()
        self.grp = self.group()
        self.link = self.student()


class OpeningTests(SeatClassCase, TestCase):
    def test_a_seat_opens_with_the_paired_groups_class(self):
        pair(self.grp, self.room)
        self.member(self.grp, self.link)
        shadow.open_ledger(NOW, apply=True)
        self.assertEqual(Seat.objects.get().classroom, self.room)

    def test_a_group_paired_with_no_class_leaves_the_seat_without_one(self):
        self.member(self.grp, self.link)
        shadow.open_ledger(NOW, apply=True)
        self.assertIsNone(Seat.objects.get().classroom)

    def test_a_suggested_pairing_is_not_a_pairing(self):
        LcupGroupLink.objects.filter(pk=self.grp.pk).update(classroom=self.room, status=GroupLinkStatus.SUGGESTED)
        self.member(self.grp, self.link)
        shadow.open_ledger(NOW, apply=True)
        self.assertIsNone(Seat.objects.get().classroom)


class TickTests(Opened, TestCase):
    def setUp(self):
        super().setUp()
        self.room = make_room()

    def tick(self):
        result = shadow.Result()
        shadow.link_seats_to_classes(result)
        return result

    def test_seats_opened_before_this_are_filled_by_the_next_pass(self):
        pair(self.grp, self.room)
        self.assertIsNone(self.seat().classroom)
        result = self.tick()
        self.assertEqual(self.seat().classroom, self.room)
        self.assertEqual(result.counts["seats_linked"], 1)

    def test_a_second_pass_changes_nothing(self):
        pair(self.grp, self.room)
        self.tick()
        self.assertEqual(self.tick().counts["seats_linked"], 0)

    def test_a_group_paired_with_another_class_takes_the_seat_with_it(self):
        pair(self.grp, self.room)
        self.tick()
        other = make_room("Middle G2")
        LcupGroupLink.objects.filter(pk=self.grp.pk).update(classroom=other)
        self.tick()
        self.assertEqual(self.seat().classroom, other)

    def test_a_pairing_taken_off_takes_the_class_off_the_seat(self):
        pair(self.grp, self.room)
        self.tick()
        LcupGroupLink.objects.filter(pk=self.grp.pk).update(classroom=None)
        self.tick()
        self.assertIsNone(self.seat().classroom)

    def test_a_class_passed_from_one_group_to_another_does_not_trip_over_itself(self):
        second = self.group(lcup_id=11, name="Junior G1 again")
        self.member(second, self.link)
        shadow.watch(NOW)
        pair(self.grp, self.room)
        self.tick()
        LcupGroupLink.objects.filter(pk=self.grp.pk).update(classroom=None)
        pair(second, self.room)
        self.assertEqual(self.tick().errors, [])
        self.assertEqual(Seat.objects.get(lcup_group_id=11).classroom, self.room)
        self.assertIsNone(Seat.objects.get(lcup_group_id=10).classroom)

    def test_a_seat_with_no_lc_up_group_is_left_alone(self):
        own = make_seat(self.account(), name="Ours", group=None)
        Seat.objects.filter(pk=own.pk).update(classroom=self.room)
        self.tick()
        own.refresh_from_db()
        self.assertEqual(own.classroom, self.room)

    def test_a_clash_with_a_seat_of_our_own_is_reported_and_stops_only_itself(self):
        Seat.objects.create(account=self.account(), group_name="Ours", classroom=self.room, price=500_000, days=[1, 3, 5], state="active")
        pair(self.grp, self.room)
        result = self.tick()
        self.assertEqual(len(result.errors), 1)
        self.assertIsNone(self.seat().classroom)

    def test_the_tick_keeps_them_linked(self):
        pair(self.grp, self.room)
        with self.settings(BILLING_SHADOW_ENABLED=True):
            shadow.tick(NOW)
        self.assertEqual(self.seat().classroom, self.room)


class ConstraintTests(TestCase):
    def test_an_account_has_one_seat_per_class(self):
        room = make_room()
        account = Account.objects.create(name="A student")
        Seat.objects.create(account=account, group_name="a", classroom=room, state="trial")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Seat.objects.create(account=account, group_name="b", classroom=room, state="trial")

    def test_seats_without_a_class_do_not_clash(self):
        account = Account.objects.create(name="A student")
        Seat.objects.create(account=account, group_name="a", lcup_group_id=1, state="left")
        Seat.objects.create(account=account, group_name="b", lcup_group_id=2, state="left")
        self.assertEqual(account.seats.count(), 2)

    def test_deleting_a_class_keeps_the_seat(self):
        room = make_room()
        seat = Seat.objects.create(account=Account.objects.create(name="A student"), group_name="a", classroom=room, state="left")
        room.delete()
        seat.refresh_from_db()
        self.assertIsNone(seat.classroom)
        self.assertEqual(seat.group_name, "a")
