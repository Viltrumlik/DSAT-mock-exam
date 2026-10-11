"""Shared fixtures for the /api/desktop/v1/ tests: the wire-contract loader and shape check,
data factories, and a client that talks like the app."""

from __future__ import annotations

import datetime as _dt
import json
import uuid
from functools import lru_cache
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from exams.models import Module, PracticeTest, Question, TestAttempt
from midterms.models import Midterm, MidtermAttempt

User = get_user_model()

#: ``desktop-native/contracts/v1/`` — the JSON the app's tests load too.
CONTRACT_DIR = Path(__file__).resolve().parents[4] / "desktop-native" / "contracts" / "v1"

APP_HEADER = "windows/0.2.0"


# ── the contract ─────────────────────────────────────────────────────────────────────────
@lru_cache(maxsize=None)
def manifest() -> dict:
    with open(CONTRACT_DIR / "manifest.json", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=None)
def _fixture_text(name: str) -> str:
    with open(CONTRACT_DIR / name, encoding="utf-8") as fh:
        return fh.read()


def fixture(name: str):
    """A contract fixture by file name (``"pastpaper_open.response.json"``), freshly parsed."""
    if not name.endswith(".json"):
        name += ".json"
    return json.loads(_fixture_text(name))


#: Keys the app's models read as nullable (``…OrNull`` in ``app/lib/core/models``). A fixture
#: that happens to show a value there does not make null wrong; anywhere else a null where the
#: fixture has a value would fail the app's parse, so the shape check refuses it.
NULLABLE = frozenset(
    {
        "attempt_id", "available_at", "calculator", "certificate", "cohort_size", "collection_name",
        "completed_at", "deadline", "deadline_at", "due_at", "form_type", "image_key", "label",
        "last_attempt_id", "last_completed_at", "last_score", "latest_version", "midterm",
        "minimum_version", "module", "next_module", "open_attempt_id", "open_state", "options",
        "poll_after_ms", "practice_date", "previous_score", "question_image_key", "questions",
        "rank", "reason", "remaining_ms", "reopened", "result", "score", "score_ceiling",
        "score_delta", "set_at", "student_answer", "terminated_reason", "total_score",
        "transitioned_to",
    }
)


def _is_keyed_map(d: dict) -> bool:
    """``{"301": …}`` (ids) or ``{"A": …}`` (option letters): a map, not a record."""
    return bool(d) and all(isinstance(k, str) and (k.isdigit() or (len(k) == 1 and k.isupper())) for k in d)


def assert_shape(test: TestCase, actual, expected, path: str = "$", key: str | None = None) -> None:
    """``actual`` has the fixture's shape field-for-field: the same keys at every level, the
    same JSON types, lists checked item by item against the fixture's first item, id-keyed
    maps checked value by value. A null is accepted where the app reads the key as nullable."""
    if actual is None and expected is None:
        return
    if actual is None:
        test.assertIn(key, NULLABLE, f"{path}: null where the contract has a value ({expected!r})")
        return
    if expected is None:
        return
    if isinstance(expected, bool) or isinstance(actual, bool):
        test.assertIs(type(actual), bool, f"{path}: expected a boolean, got {actual!r}")
        test.assertIs(type(expected), bool, f"{path}: the contract has {expected!r}, got a boolean")
        return
    if isinstance(expected, int):
        test.assertIsInstance(actual, int, f"{path}: expected an integer, got {actual!r}")
        return
    if isinstance(expected, float):
        test.assertIsInstance(actual, (int, float), f"{path}: expected a number, got {actual!r}")
        return
    if isinstance(expected, str):
        test.assertIsInstance(actual, str, f"{path}: expected a string, got {actual!r}")
        return
    if isinstance(expected, list):
        test.assertIsInstance(actual, list, f"{path}: expected a list, got {actual!r}")
        if expected:
            for i, item in enumerate(actual):
                assert_shape(test, item, expected[0], f"{path}[{i}]", key)
        return
    if isinstance(expected, dict):
        test.assertIsInstance(actual, dict, f"{path}: expected an object, got {actual!r}")
        if _is_keyed_map(expected) or (not expected and _is_keyed_map(actual)):
            for k in actual:
                test.assertTrue(isinstance(k, str) and (k.isdigit() or len(k) == 1), f"{path}: map key {k!r}")
            sample = next(iter(expected.values()), None) if expected else None
            if sample is not None:
                for k, v in actual.items():
                    assert_shape(test, v, sample, f"{path}.{k}", key)
            return
        test.assertEqual(
            sorted(actual), sorted(expected),
            f"{path}: keys differ — missing {sorted(set(expected) - set(actual))}, extra {sorted(set(actual) - set(expected))}",
        )
        for k in expected:
            assert_shape(test, actual[k], expected[k], f"{path}.{k}", k)
        return
    test.fail(f"{path}: unexpected fixture type {type(expected).__name__}")  # pragma: no cover


def iso_ms(value: str) -> bool:
    """``2026-10-11T09:00:00.000Z`` — the one timestamp format on the wire."""
    try:
        _dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except (TypeError, ValueError):
        return False
    return len(value) == 24


# ── factories ────────────────────────────────────────────────────────────────────────────
def make_student(username: str = "aziza", **extra) -> User:
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="pw-not-used",
        role="student",
        first_name=extra.pop("first_name", "Aziza"),
        last_name=extra.pop("last_name", "Karimova"),
        **extra,
    )


def _question(module: Module, i: int, *, qtype: str, grid_in: bool = False, image: str | None = None,
              option_images: bool = False, correct: str = "B") -> Question:
    if grid_in:
        return Question.objects.create(
            module=module, question_type=qtype, question_text=f"<p>Grid-in {i}: what is $x$?</p>",
            correct_answers=correct or "7/2, 3.5", is_math_input=True, order=i, question_image=image,
        )
    kwargs = dict(
        module=module, question_type=qtype, question_text=f"<p>Question {i} of module {module.module_order}.</p>",
        question_prompt="Which choice is best?" if i % 2 else "",
        option_a="$3$", option_b="$5$", option_c="$\\frac{25}{3}$", option_d="$15$",
        correct_answers=correct, is_math_input=False, order=i, question_image=image,
    )
    if option_images:
        kwargs.update(
            option_a="", option_b="", option_c="", option_d="",
            option_a_image=f"option_images/m{module.module_order}-q{i}-a.png",
            option_b_image=f"option_images/m{module.module_order}-q{i}-b.png",
            option_c_image=f"option_images/m{module.module_order}-q{i}-c.png",
            option_d_image=f"option_images/m{module.module_order}-q{i}-d.png",
        )
    return Question.objects.create(**kwargs)


def make_paper(*, subject: str = "MATH", m1: int = 4, m2: int = 3, assign_to=None, label: str = "A",
               practice_date=_dt.date(2025, 10, 4), collection: str = "October 2025 US A",
               images: bool = True) -> PracticeTest:
    """A standalone past paper. Module 1's first question is a grid-in (Math), its second has
    a figure, its third has picture options; everything else is plain multiple choice whose
    key is "B"."""
    pt = PracticeTest.objects.create(
        subject=subject, title="", label=label, form_type="US", practice_date=practice_date,
        collection_name=collection, is_published=True,
    )
    qtype = "MATH" if subject == "MATH" else "READING"
    modules = {m.module_order: m for m in pt.modules.all()}
    for order, count in ((1, m1), (2, m2)):
        module = modules[order]
        for i in range(count):
            _question(
                module, i, qtype=qtype,
                grid_in=(subject == "MATH" and order == 1 and i == 0),
                correct=("7/2, 3.5" if (subject == "MATH" and order == 1 and i == 0) else "B"),
                image=(f"question_images/{pt.pk}-m{order}-q{i}.png" if images and order == 1 and i == 1 else None),
                option_images=(images and order == 1 and i == 2),
            )
    if assign_to is not None:
        pt.assigned_users.add(assign_to)
    return pt


def paper_modules(pt: PracticeTest) -> tuple[Module, Module]:
    mods = {m.module_order: m for m in pt.modules.all()}
    return mods[1], mods[2]


def module_qids(module: Module) -> list[int]:
    return list(Question.objects.filter(module=module).order_by("order", "created_at", "id").values_list("id", flat=True))


def make_midterm(*, n1: int = 3, n2: int = 2, minutes: int = 35, scale: str = Midterm.SCALE_800,
                 subject: str = Midterm.MATH, level: str = "middle", title: str = "October Midterm · Math") -> Midterm:
    m1 = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=minutes)
    m2 = Module.objects.create(practice_test=None, module_order=2, time_limit_minutes=minutes) if n2 else None
    qtype = "MATH" if subject == Midterm.MATH else "READING"
    for i in range(n1):
        _question(m1, i, qtype=qtype, image=("question_images/mt-m1-q1.png" if i == 1 else None))
    for i in range(n2):
        _question(m2, i, qtype=qtype, image=("question_images/mt-m2-q0.png" if i == 0 else None))
    return Midterm.objects.create(
        title=title, subject=subject, scoring_scale=scale, level=level,
        duration_minutes=minutes, duration_minutes_2=(minutes if n2 else None),
        question_module=m1, question_module_2=m2, is_published=True,
    )


def grant_midterm(student, midterm, *, classroom=None) -> ResourceAccessGrant:
    kwargs = dict(
        user=student, resource_type=RT_MIDTERM_V2, resource_id=midterm.id,
        scope=ResourceAccessGrant.SCOPE_RESOURCE, status=ResourceAccessGrant.STATUS_ACTIVE,
    )
    if classroom is not None:
        kwargs.update(classroom=classroom, source=ResourceAccessGrant.SOURCE_CLASSROOM)
    return ResourceAccessGrant.objects.create(**kwargs)


def make_classroom(teacher_username: str = "teacher"):
    from classes.models import Classroom, ClassroomMembership

    teacher = User.objects.create_user(
        username=teacher_username, email=f"{teacher_username}@example.com", password="x", role="teacher"
    )
    room = Classroom.objects.create(name="SAT Evening B", subject="MATH", lesson_days=Classroom.DAYS_ODD, created_by=teacher)
    ClassroomMembership.objects.create(classroom=room, user=teacher, role=ClassroomMembership.ROLE_ADMIN)
    return room


def join(room, student):
    from classes.models import ClassroomMembership

    return ClassroomMembership.objects.create(classroom=room, user=student, role=ClassroomMembership.ROLE_STUDENT)


def shift_pastpaper_clock(attempt_id: int, *, seconds_ago: int, order: int = 1) -> None:
    """Pretend the live module started ``seconds_ago`` seconds ago."""
    started = timezone.now() - _dt.timedelta(seconds=seconds_ago)
    field = "module_1_started_at" if order == 1 else "module_2_started_at"
    TestAttempt.objects.filter(pk=attempt_id).update(**{field: started, "current_module_start_time": started})


def shift_midterm_clock(attempt_id: int, *, seconds_ago: float, order: int = 1, now=None) -> None:
    """Pretend the live midterm module started ``seconds_ago`` seconds before ``now``."""
    started = (now or timezone.now()) - _dt.timedelta(seconds=seconds_ago)
    field = "started_at" if order == 1 else "module_2_started_at"
    MidtermAttempt.objects.filter(pk=attempt_id).update(**{field: started})


# ── the app's client ─────────────────────────────────────────────────────────────────────
class AppClient:
    """Speaks like the app: the windows/<semver> header, JSON bodies, explicit idempotency
    keys and the lockdown token header when given one."""

    BASE = "/api/desktop/v1/"

    def __init__(self, user=None, *, header: str = APP_HEADER):
        self.api = APIClient()
        self.header = header
        if user is not None:
            self.api.force_authenticate(user)

    def _headers(self, key=None, lockdown=None, extra=None) -> dict:
        h = {}
        if self.header:
            h["HTTP_X_MASTERSAT_CLIENT"] = self.header
        if key:
            h["HTTP_IDEMPOTENCY_KEY"] = key
        if lockdown:
            h["HTTP_X_LOCKDOWN_SESSION"] = lockdown
        h.update(extra or {})
        return h

    def get(self, path: str, *, lockdown=None, **extra):
        return self.api.get(self.BASE + path, **self._headers(lockdown=lockdown, extra=extra))

    def post(self, path: str, body=None, *, key=None, lockdown=None, **extra):
        return self.api.post(
            self.BASE + path, body if body is not None else {}, format="json",
            **self._headers(key=key, lockdown=lockdown, extra=extra),
        )


def new_key(prefix: str) -> str:
    return f"{prefix}.{uuid.uuid4().hex[:12]}"


@override_settings(DESKTOP_V1_ENABLED=True, DESKTOP_V1_SHIP_MODULE_2=True, MIDTERM_DESKTOP_REQUIRED=False)
class V1TestCase(TestCase):
    """v1 switched on; the midterm lockdown rule off unless a test turns it on."""

    def setUp(self):
        super().setUp()
        cache.clear()

    def assertContract(self, response_json, fixture_name: str):
        assert_shape(self, response_json, fixture(fixture_name))
