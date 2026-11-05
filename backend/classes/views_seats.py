"""The seat actions on a class's /ops page (``classes.seat_actions``). Admins only; under /api/classes/, which the
admin console already allows. A refusal comes back in words, and while lc-up runs as its usual 409."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status as http
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.views import IsGlobalAdmin
from users.changelist import to_int
from users.people_detail import _live_seats, display_name, iso, section_of

from . import seat_actions as S
from .models import Classroom

User = get_user_model()

LOCKED = "Seats are managed in lc-up until the centre leaves it."


def _today():
    return timezone.localdate()


def _day(data, today):
    if not data.get("date"):
        return today
    try:
        day = parse_date(str(data["date"]))
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        day = None
    if day is None:
        raise S.SeatRefused("That is not a date.")
    return day


def _seat_row(row) -> dict:
    return {
        "user_id": row.user_id, "classroom_id": row.classroom_id, "status": row.status, "seat_status": row.seat_status,
        "seat_start_date": iso(row.seat_start_date), "seat_left_on": iso(row.seat_left_on),
    }


def _answer(call, *, status=http.HTTP_200_OK, **extra) -> Response:
    from lcup.guards import lcup_managed_response

    try:
        row = call()
    except S.SeatsLocked:
        return lcup_managed_response(detail=LOCKED)
    except S.SeatRefused as refused:
        return Response({"detail": str(refused)}, status=http.HTTP_400_BAD_REQUEST)
    return Response({**_seat_row(row), **extra}, status=status)


class SeatAddView(APIView):
    """``POST …/seats/`` {user_id, status, date}: an existing student takes a seat."""

    permission_classes = [IsGlobalAdmin]

    def post(self, request, pk: int):
        room = get_object_or_404(Classroom, pk=pk)
        user_id = to_int(request.data.get("user_id"))
        if not user_id:
            return Response({"detail": "Choose a student."}, status=http.HTTP_400_BAD_REQUEST)
        user = get_object_or_404(User, pk=user_id)
        today = _today()
        return _answer(
            lambda: S.add_student(room, user, request.data.get("status"), _day(request.data, today), today=today, by=request.user),
            status=http.HTTP_201_CREATED,
        )


def _holder(user) -> dict:
    return {
        "id": user.pk, "name": display_name(user), "section": section_of(user),
        "groups": [seat.classroom.name for seat in _live_seats([user.pk]).order_by("classroom__name")],
        "can_add": S.enrol_refusal(user) is None,
    }


class SeatNewStudentView(APIView):
    """``POST …/seats/new-student/`` {full_name, phone, parent_name?, parent_phone?, status, date}: someone new to the
    centre. A phone that is someone else's stops it with a 409 naming them."""

    permission_classes = [IsGlobalAdmin]

    def post(self, request, pk: int):
        from lcup.accounts import PhoneTaken
        from lcup.phones import normalize_phone

        room = get_object_or_404(Classroom, pk=pk)
        data, today = request.data, _today()
        phone = normalize_phone(data.get("phone"))
        try:
            return _answer(
                lambda: S.new_student(
                    room, full_name=data.get("full_name"), phone=data.get("phone"), parent_name=data.get("parent_name"),
                    parent_phone=data.get("parent_phone"), status=data.get("status"), day=_day(data, today), today=today,
                    by=request.user,
                ),
                status=http.HTTP_201_CREATED,
                # What to tell them: the first sign-in is the phone and its last four digits.
                login={"phone": phone, "code": (phone or "")[-4:]},
            )
        except PhoneTaken as taken:
            holder = _holder(taken.account)
            detail = (
                f"This phone is on {holder['name']}'s account. Add them to this group, or type a different phone for a sibling."
                if holder["can_add"]
                else f"This phone is on {holder['name']}'s account, so a new student cannot have it. Type a different phone."
            )
            return Response({"detail": detail, "code": "phone_taken", "account": holder}, status=http.HTTP_409_CONFLICT)


class SeatActionView(APIView):
    """``POST …/seats/<user_id>/<action>/`` {date, to_classroom?}: activate, freeze, return, move, leave, fix-date."""

    permission_classes = [IsGlobalAdmin]

    ACTIONS = {
        "activate": S.activate, "freeze": S.freeze, "return": S.return_seat, "leave": S.leave, "fix-date": S.fix_date,
    }

    def post(self, request, pk: int, user_id: int, action: str):
        room = get_object_or_404(Classroom, pk=pk)
        user = get_object_or_404(User, pk=user_id)
        today, data = _today(), request.data
        if action == "move":
            to_room = Classroom.objects.filter(pk=to_int(data.get("to_classroom"))).first()

            def run():
                if to_room is None:
                    raise S.SeatRefused("Choose the group to move them to.")
                return S.move(room, user, to_room, _day(data, today), today=today, by=request.user)

            return _answer(run)
        act = self.ACTIONS.get(action)
        if act is None:
            return Response({"detail": "Not found."}, status=http.HTTP_404_NOT_FOUND)
        return _answer(lambda: act(room, user, _day(data, today), today=today, by=request.user))
