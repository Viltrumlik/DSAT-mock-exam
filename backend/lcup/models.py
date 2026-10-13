"""What we know about lc-up, and how it maps onto our records.

lc-up is the master for groups and their members (the owner's decision), so these tables hold
lc-up's ids next to ours: a *link* row per lc-up filial, teacher, student and group, plus the
membership lc-up last reported. The sync (``sync.py``) fills them; the admin reviews whatever
could not be linked automatically in ``/ops/lcup``.

``AccountClaim`` belongs to the accounts the sync creates for students who had none: the first
sign-in is phone + its last four digits (``auth_backend``), and the claim is what limits that.
"""

from django.conf import settings
from django.db import models, transaction
from django.db.models import F
from django.utils import timezone

#: Wrong codes before a claim locks. The admin unlocks it by reissuing.
MAX_CLAIM_FAILURES = 5


class LinkStatus(models.TextChoices):
    UNMATCHED = "unmatched", "Unmatched"
    AUTO = "auto", "Auto-linked"
    NEEDS_REVIEW = "needs_review", "Needs review"
    CONFIRMED = "confirmed", "Confirmed"
    CREATED = "created", "Account created"
    IGNORED = "ignored", "Ignored"


class GroupLinkStatus(models.TextChoices):
    SUGGESTED = "suggested", "Suggested"
    NEEDS_TEACHER = "needs_teacher", "Needs a linked teacher"
    CONFIRMED = "confirmed", "Confirmed"
    IGNORED = "ignored", "Ignored"


class LcupState(models.Model):
    """One row. ``initial_review_done_at`` is the gate on creating accounts: until the admin has
    linked everyone who already has an account, a new one would be a duplicate."""

    initial_review_done_at = models.DateTimeField(null=True, blank=True)
    initial_review_done_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    @classmethod
    def get(cls) -> "LcupState":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class LcupFilialLink(models.Model):
    lcup_filial_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    branch = models.ForeignKey(
        "classes.Branch", null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_filials"
    )
    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name


class LcupTeacherLink(models.Model):
    lcup_teacher_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, default="", db_index=True)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_teacher_link"
    )
    status = models.CharField(max_length=16, choices=LinkStatus.choices, default=LinkStatus.UNMATCHED, db_index=True)
    candidates = models.JSONField(default=list, blank=True)
    match_reason = models.CharField(max_length=200, blank=True, default="")
    deleted_in_lcup = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name


class LcupStudentLink(models.Model):
    lcup_student_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, default="", db_index=True)
    lcup_filial_id = models.PositiveIntegerField(null=True, blank=True)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_student_link"
    )
    status = models.CharField(max_length=16, choices=LinkStatus.choices, default=LinkStatus.UNMATCHED, db_index=True)
    candidates = models.JSONField(default=list, blank=True)
    match_reason = models.CharField(max_length=200, blank=True, default="")
    deleted_in_lcup = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    #: lc-up's balance as last seen; negative means the student owes the center. None = unknown
    #: (never seen, or lc-up sent something that is not a number), never mistaken for 0.
    balance = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    balance_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name


class LcupGroupLink(models.Model):
    lcup_group_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    #: The whole lc-up group row as last fetched (course, days, times, teachers, filial…).
    snapshot = models.JSONField(default=dict, blank=True)
    classroom = models.OneToOneField(
        "classes.Classroom", null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_group_link"
    )
    status = models.CharField(
        max_length=16, choices=GroupLinkStatus.choices, default=GroupLinkStatus.SUGGESTED, db_index=True
    )
    suggestion = models.ForeignKey(
        "classes.Classroom", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    suggestion_score = models.FloatField(default=0)
    suggestion_reasons = models.JSONField(default=list, blank=True)
    deleted_in_lcup_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name


class LcupMembership(models.Model):
    """Who lc-up says is in a group. ``left_at`` set means they have left it."""

    group = models.ForeignKey(LcupGroupLink, on_delete=models.CASCADE, related_name="memberships")
    student = models.ForeignKey(LcupStudentLink, on_delete=models.CASCADE, related_name="memberships")
    lcup_status = models.CharField(max_length=10)  # active | trial | frozen
    start_date = models.DateField(null=True, blank=True)
    joined_at = models.DateTimeField(null=True, blank=True)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["group", "student"], name="lcup_membership_unique")]


class AccountClaim(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lcup_claim")
    phone = models.CharField(max_length=20, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_at = models.DateTimeField(null=True, blank=True)
    first_login_at = models.DateTimeField(null=True, blank=True)
    password_set_at = models.DateTimeField(null=True, blank=True)
    reissued_count = models.PositiveSmallIntegerField(default=0)

    def can_attempt(self, now) -> bool:
        return self.password_set_at is None and self.locked_at is None and self.expires_at > now

    def record_failure(self, now) -> None:
        # F() so two wrong codes typed at once both count — a read-modify-write would lose one.
        with transaction.atomic():
            AccountClaim.objects.filter(pk=self.pk).update(failed_attempts=F("failed_attempts") + 1)
            self.refresh_from_db(fields=["failed_attempts"])
            if self.failed_attempts >= MAX_CLAIM_FAILURES and self.locked_at is None:
                self.locked_at = now
                self.save(update_fields=["locked_at"])

    def record_success(self, now) -> None:
        updates = {"failed_attempts": 0}
        if self.first_login_at is None:
            updates["first_login_at"] = now
        AccountClaim.objects.filter(pk=self.pk).update(**updates)
        for field, value in updates.items():
            setattr(self, field, value)


class LcupSyncRun(models.Model):
    # Not auto_now_add: a dry run's row is written after its rolled-back transaction, and must
    # still say when the run began.
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    dry_run = models.BooleanField(default=False)
    ok = models.BooleanField(default=False)
    counts = models.JSONField(default=dict, blank=True)
    errors = models.JSONField(default=list, blank=True)
    alerts = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-started_at"]
