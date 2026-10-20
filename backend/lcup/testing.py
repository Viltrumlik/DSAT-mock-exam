"""A stand-in for ``LcupClient`` in tests. Never touches the network, the cache or credentials."""

from datetime import date, datetime

from django.utils import timezone

from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupStudentLink, LinkStatus
from users.models import User

#: The key in a FakeLcupClient's ``data`` that answers ``post_attendance``.
POST_ATTENDANCE = "POST /attendance"


class FakeLcupClient:
    """Answers from a dict keyed by path.

    A value may be a list (rows, for ``fetch_all`` or as a ``get`` body's ``data``), a dict (a
    whole ``get`` body) or an ``Exception`` instance, which is raised. Every call is recorded in
    ``.calls`` as ``(path, params)``.
    """

    def __init__(self, data: dict):
        self.data = data
        self.calls: list[tuple[str, dict]] = []
        self.posts: list[tuple] = []

    def _lookup(self, path, params):
        self.calls.append((path, dict(params or {})))
        value = self.data.get(path, [])
        if isinstance(value, Exception):
            raise value
        return value

    def get(self, path, params=None) -> dict:
        value = self._lookup(path, params)
        return value if isinstance(value, dict) else {"success": True, "data": list(value)}

    def fetch_all(self, path, params=None) -> list[dict]:
        value = self._lookup(path, params)
        return list(value.get("data", [])) if isinstance(value, dict) else list(value)

    def post_attendance(self, group_id, day, records) -> dict:
        """Recorded in ``.posts`` as ``(group_id, day, records)``. ``data["POST /attendance"]`` may
        be an ``Exception`` (raised), a callable ``(group_id, day, records) -> dict``, or a dict;
        absent, lc-up "saves" every record. The real switch is honoured, as the client does."""
        from .client import LcupError
        from .conf import attendance_push_enabled

        if not attendance_push_enabled():
            raise LcupError("attendance push is switched off")
        self.posts.append((group_id, day, [dict(r) for r in records]))
        answer = self.data.get(POST_ATTENDANCE)
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(group_id, day, records)
        if isinstance(answer, dict):
            return answer
        results = [{"student_id": r["student_id"], "status": r["status"], "result": "saved", "error": None} for r in records]
        return {"group_id": group_id, "date": day.isoformat(), "results": results,
                "summary": {"saved": len(records), "deleted": 0, "unchanged": 0, "failed": 0}}


class FollowupsFixtureMixin:
    """A class paired with lc-up (Mon/Wed/Fri 14:00–16:00, so its register closes at 18:00), its
    teacher, and helpers for lc-up seats and marks — the common ground of the follow-up tests
    (lcup.followups). Mix it in before ``TestCase``."""

    MONDAY = date(2026, 10, 19)
    #: Seats are taken well before every lesson the tests mark, so the register's own rule (a seat
    #: taken after a lesson is not on it) never hides a student.
    SEATED_AT = datetime(2026, 9, 1, 9, 0)

    def setUp(self):
        super().setUp()
        self.teacher = User.objects.create_user(
            None, password=None, username="teach", role="teacher", subject="math", first_name="Tess", last_name="Teacher"
        )
        self.admin = User.objects.create_user(None, password=None, username="adm", role="admin")
        self.room = Classroom.objects.create(
            name="Middle G23", subject="MATH", lesson_days="ODD", lesson_time="14:00-16:00",
            created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN)
        self.group = LcupGroupLink.objects.create(
            lcup_group_id=501, name="Middle G23 | Math", classroom=self.room, status=GroupLinkStatus.CONFIRMED
        )
        self._lcup_ids = iter(range(9001, 9999))

    def student(self, first, last, *, seat=True):
        user = User.objects.create_user(
            None, password=None, username=f"{first}{last}".lower(), role="student", first_name=first, last_name=last
        )
        if seat:
            seat_row = ClassroomMembership.objects.create(classroom=self.room, user=user, role=ClassroomMembership.ROLE_STUDENT)
            ClassroomMembership.objects.filter(pk=seat_row.pk).update(joined_at=timezone.make_aware(self.SEATED_AT))
        return user

    def lcup_member(self, name, *, user=None, status="active", since=None, link_status=None, group=None):
        link = LcupStudentLink.objects.create(
            lcup_student_id=next(self._lcup_ids), name=name, user=user,
            status=link_status or (LinkStatus.CONFIRMED if user else LinkStatus.UNMATCHED),
        )
        return LcupMembership.objects.create(group=group or self.group, student=link, lcup_status=status, start_date=since)

    def mark(self, day, user, status):
        session, _ = AttendanceSession.objects.get_or_create(
            classroom=self.room, date=day, defaults={"created_by": self.teacher}
        )
        record, _ = AttendanceRecord.objects.update_or_create(session=session, student=user, defaults={"status": status})
        return record
