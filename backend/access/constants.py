"""Authorization constants: RBAC + single subject domain + DB-backed access.

Subject vocabulary (platform ``MATH`` / ``READING_WRITING`` vs domain ``math`` / ``english``)
is defined and converted only in ``access.subject_mapping``.
"""

WILDCARD = "*"

# Canonical permission codenames (spec)
PERM_MANAGE_USERS = "manage_users"
PERM_ASSIGN_ACCESS = "assign_access"
PERM_CREATE_CLASSROOM = "create_classroom"
PERM_MANAGE_TESTS = "manage_tests"
PERM_VIEW_DASHBOARD = "view_dashboard"
PERM_SUBMIT_TEST = "submit_test"

# Semantic aliases (same DB codename — use helpers for *view* vs *edit* semantics):
#   can_edit_tests()  → authorize(..., PERM_EDIT_TESTS, subject=platform)
#   can_view_tests()  → edit OR assign_access in subject scope (no separate DB perm)
PERM_EDIT_TESTS = PERM_MANAGE_TESTS

ALL_PERMISSION_CODENAMES = (
    PERM_SUBMIT_TEST,
    PERM_MANAGE_USERS,
    PERM_ASSIGN_ACCESS,
    PERM_CREATE_CLASSROOM,
    PERM_MANAGE_TESTS,
    PERM_VIEW_DASHBOARD,
)

# ``authorize(..., subject=<platform>)`` MUST receive a valid platform subject for these
# (MATH / READING_WRITING), except super_admin / Django superuser (wildcard).
PERMISSIONS_REQUIRING_PLATFORM_SUBJECT = frozenset(
    {
        PERM_MANAGE_USERS,
        PERM_MANAGE_TESTS,
        PERM_ASSIGN_ACCESS,
        PERM_CREATE_CLASSROOM,
    }
)

# Overrides must never grant these to students (defense in depth vs. bad admin data).
PERMISSIONS_STUDENT_OVERRIDE_DENIED = PERMISSIONS_REQUIRING_PLATFORM_SUBJECT

# Domain subject stored on User.subject and UserAccess.subject.
DOMAIN_MATH = "math"
DOMAIN_ENGLISH = "english"
ALL_DOMAIN_SUBJECTS = (DOMAIN_MATH, DOMAIN_ENGLISH)

#: A support teacher who covers both subjects.
#:
#: Deliberately NOT in ``ALL_DOMAIN_SUBJECTS``, and this is the load-bearing decision. That
#: tuple is the vocabulary of *grants and resources* — a ``UserAccess`` row, an
#: ``AssessmentSet``, a ``PracticeTest`` — and "both" is meaningless there: a question is
#: maths or it is english. It is only ever a property of a *person*.
#:
#: The practical consequence is that nothing which compares a single subject needs to change.
#: ``user_domain_subject`` still returns one value or None; a "both" member of staff simply
#: gets None from it, and the comparison sites that must understand them use
#: :func:`access.services.user_domain_subjects` instead. Making the singular function return
#: "both" would have been the tempting change and a silent disaster — every caller compares
#: its result with ``==`` against one domain, so a "both" teacher would have been denied
#: everywhere rather than allowed everywhere.
DOMAIN_BOTH = "both"

#: What ``User.subject`` may hold. A superset of ``ALL_DOMAIN_SUBJECTS``.
ALL_STAFF_SUBJECTS = (DOMAIN_MATH, DOMAIN_ENGLISH, DOMAIN_BOTH)

#: Which domains a stored ``User.subject`` value actually covers.
SUBJECTS_COVERED_BY = {
    DOMAIN_MATH: (DOMAIN_MATH,),
    DOMAIN_ENGLISH: (DOMAIN_ENGLISH,),
    DOMAIN_BOTH: ALL_DOMAIN_SUBJECTS,
}


def allowed_subjects_for_role(role: str) -> tuple:
    """What ``User.subject`` may be for a given role.

    "both" is a **support teacher's** option and nobody else's. A support teacher helps
    whoever books them and the school wanted one account able to take both queues; a class
    teacher owns a classroom, and a classroom has exactly one subject, so a both-subject
    teacher would be a teacher no classroom could be aligned against.
    """
    normalized = str(role or "").strip().lower()
    if normalized == ROLE_SUPPORT_TEACHER:
        return ALL_STAFF_SUBJECTS
    return ALL_DOMAIN_SUBJECTS

# Platform subject values stored in DB (PracticeTest.subject)
SUBJECT_ENGLISH_PLATFORM = "READING_WRITING"  # "English / R&W"
SUBJECT_MATH_PLATFORM = "MATH"

# Canonical RBAC roles (lowercase, per spec)
ROLE_SUPER_ADMIN = "super_admin"
ROLE_ADMIN = "admin"
ROLE_TEACHER = "teacher"
ROLE_TEST_ADMIN = "test_admin"
# Content reviewer / QA: a global-scope, subject-less staff role that may review ALL
# tests (assessments, pastpapers, mocks, midterms) read-only on the student site with no
# timer/fullscreen/proctoring, and may enter the builder to change set status (incl.
# approve) and edit questions. Not a user/classroom manager — no manage_users / assign_access.
ROLE_TEST_AUDITOR = "test_auditor"
# Support teacher: a subject-scoped member of the teaching team who students book for help
# outside the lesson. Deliberately weaker than ``teacher`` — it may enter the teacher portal
# and work inside the classrooms it is assigned to, but it authors nothing, creates no
# classrooms and manages no users. Inside a classroom it holds the existing
# ``ClassroomMembership.ROLE_TA`` capability set rather than a new one.
ROLE_SUPPORT_TEACHER = "support_teacher"
ROLE_STUDENT = "student"

CANONICAL_ROLES = frozenset(
    {
        ROLE_SUPER_ADMIN,
        ROLE_ADMIN,
        ROLE_TEACHER,
        ROLE_TEST_ADMIN,
        ROLE_TEST_AUDITOR,
        ROLE_SUPPORT_TEACHER,
        ROLE_STUDENT,
    }
)

#: Ordered (role, label) pairs for forms — Django admin above all, which had no way to see
#: or set ``User.role`` at all: the admin exposed only ``system_role`` (the FK), and this
#: field carried no choices, so even adding it would have rendered a free-text box.
#:
#: A tuple, not a comprehension over CANONICAL_ROLES: a frozenset has no order, so generating
#: the pairs from it makes ``makemigrations`` emit a fresh AlterField whenever the set happens
#: to rehash.
ROLE_CHOICES = (
    (ROLE_STUDENT, "Student"),
    (ROLE_TEACHER, "Teacher"),
    (ROLE_SUPPORT_TEACHER, "Support teacher"),
    (ROLE_TEST_ADMIN, "Test admin"),
    (ROLE_TEST_AUDITOR, "Test auditor"),
    (ROLE_ADMIN, "Admin"),
    (ROLE_SUPER_ADMIN, "Super admin"),
)

#: Roles admitted to the teacher portal (``teacher.<domain>``). Intentionally role-based
#: rather than permission-based: admin and test_admin hold staff permissions elsewhere but
#: are deliberately kept off this subdomain. Previously spelled as the literal tuple
#: ``("teacher", "super_admin")`` in three independent layers — the host guard, the login
#: endpoint and the SPA guard — which is three places to forget.
TEACHER_PORTAL_ROLES = frozenset({ROLE_TEACHER, ROLE_SUPPORT_TEACHER, ROLE_SUPER_ADMIN})

#: Staff roles that belong to exactly one domain subject and must carry ``User.subject``.
#: Everything else is either global scope (super_admin / admin / test_admin / test_auditor)
#: or subject-less (student). Reference this set instead of comparing to ROLE_TEACHER —
#: a bare ``== ROLE_TEACHER`` is how a new subject-scoped role silently loses its subject
#: rules and falls through to a hard deny.
SUBJECT_SCOPED_STAFF_ROLES = frozenset({ROLE_TEACHER, ROLE_SUPPORT_TEACHER})
