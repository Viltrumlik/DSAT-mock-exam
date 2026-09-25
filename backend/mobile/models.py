"""The native app's operations: which builds may talk to the API, and what broke on phones.

Two tables, both small and both read by staff rather than students:

* ``AppReleasePolicy`` — one row per platform. The oldest build still allowed in, the newest
  one in the store, and where "Update" goes. A row, not an env var, because the moment it most
  needs changing is right after a release, by whoever is on the desk, without a deploy.
* ``ClientDiagnostic`` — crashes and hangs the app collected from MetricKit, and the non-fatal
  errors it noticed itself (above all a response it could not decode: the signal that the app
  has fallen behind the API). Written only by the app; read-only everywhere else.
"""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from .versioning import PLATFORM_IOS, parse_version

PLATFORM_CHOICES = [(PLATFORM_IOS, "iOS")]


class AppReleasePolicy(models.Model):
    platform = models.CharField(max_length=16, choices=PLATFORM_CHOICES, unique=True)
    latest_version = models.CharField(
        max_length=32,
        blank=True,
        help_text="The newest build in the App Store, e.g. 1.2.0. Older builds are asked, "
        "never forced, to update. Leave empty to ask nobody.",
    )
    minimum_version = models.CharField(
        max_length=32,
        blank=True,
        help_text="The oldest build still allowed to use the app, e.g. 1.1.0. Older builds see "
        "an update screen and nothing else. Leave empty to allow every build.",
    )
    update_url = models.URLField(
        max_length=300,
        blank=True,
        help_text="The App Store page the Update button opens.",
    )
    message = models.CharField(
        max_length=280,
        blank=True,
        help_text="Optional sentence shown with the update prompt — what the new build brings.",
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        db_table = "mobile_app_release_policy"
        verbose_name = "app release policy"
        verbose_name_plural = "app release policies"

    def __str__(self) -> str:
        return f"{self.get_platform_display()} — minimum {self.minimum_version or 'any'}, latest {self.latest_version or '—'}"

    def clean(self):
        errors = {}
        for field in ("latest_version", "minimum_version"):
            raw = (getattr(self, field) or "").strip()
            setattr(self, field, raw)
            if raw and parse_version(raw) is None:
                errors[field] = "Write a version like 1.2.0."
        minimum = parse_version(self.minimum_version)
        latest = parse_version(self.latest_version)
        if minimum and latest and minimum > latest:
            # Requiring a build newer than the newest one in the store would lock EVERY student
            # out with an Update button that leads to nothing newer.
            errors["minimum_version"] = "The minimum can't be newer than the latest version in the store."
        if errors:
            raise ValidationError(errors)


class ClientDiagnostic(models.Model):
    KIND_CRASH = "crash"
    KIND_HANG = "hang"
    KIND_CPU = "cpu"
    KIND_DISK = "disk"
    KIND_ERROR = "error"
    KIND_CHOICES = [
        (KIND_CRASH, "Crash"),
        (KIND_HANG, "Hang"),
        (KIND_CPU, "CPU limit"),
        (KIND_DISK, "Disk writes"),
        (KIND_ERROR, "App error"),
    ]
    KINDS = frozenset(k for k, _ in KIND_CHOICES)

    platform = models.CharField(max_length=16, choices=PLATFORM_CHOICES, default=PLATFORM_IOS)
    #: A random id per installation — no device identifier, no advertising id. It exists only to
    #: tell "one phone crashing forty times" from "forty phones crashing once".
    install_id = models.CharField(max_length=64)
    #: Minted by the app, so a batch retried after a lost response is stored once.
    report_id = models.CharField(max_length=64)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    #: What reports are grouped by. Paths inside it have their ids stripped on the phone.
    signature = models.CharField(max_length=200)
    message = models.CharField(max_length=500, blank=True)
    app_version = models.CharField(max_length=32, blank=True)
    build = models.CharField(max_length=32, blank=True)
    os_version = models.CharField(max_length=64, blank=True)
    device_model = models.CharField(max_length=64, blank=True)
    occurred_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
    #: Whoever was signed in when it was sent, if anyone. A crash on the sign-in screen has
    #: nobody, and is no less a crash.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    #: MetricKit's own document for a crash or hang (call stacks for symbolication), or the
    #: error's context. Capped on the phone and again at the door.
    payload = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = "mobile_client_diagnostic"
        ordering = ["-received_at"]
        constraints = [
            models.UniqueConstraint(fields=["install_id", "report_id"], name="uniq_mobile_diagnostic_report"),
        ]
        indexes = [
            models.Index(fields=["kind", "received_at"], name="mobile_diag_kind_recv"),
            models.Index(fields=["signature", "received_at"], name="mobile_diag_sig_recv"),
            models.Index(fields=["app_version", "received_at"], name="mobile_diag_ver_recv"),
        ]

    def __str__(self) -> str:
        return f"{self.kind} {self.app_version} {self.signature[:60]}"
