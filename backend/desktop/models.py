"""The Windows exam app's server half: who may skip it, how it signs in, and its lockdown proof.

Three small tables:

* ``DesktopExemption`` — a student allowed to sit midterms in the browser (a MacBook, a
  Chromebook, a laptop that will not run the app). Granted and revoked by a teacher or the desk;
  revoking keeps the row, so the history of who was let off and by whom survives.
* ``DesktopAuthCode`` — the one-time code of "Sign in with browser". The app opens the website,
  the student signs in there however they like, and the site hands the app a code it can only
  redeem with a secret that never left the app (PKCE). See ``desktop.views``.
* ``MidtermLockdown`` — one row per midterm sitting that the app has touched: whether the sitting
  is bound to the app, and the hash of the session token that proves a request comes from the
  locked-down window. See ``desktop.lockdown``.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q


class DesktopExemption(models.Model):
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="desktop_exemptions",
    )
    reason = models.CharField(max_length=200, blank=True)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        db_table = "desktop_exemption"
        ordering = ["-created_at"]
        constraints = [
            # At most one LIVE exemption per student; revoked rows stay as history.
            models.UniqueConstraint(
                fields=["student"],
                condition=Q(revoked_at__isnull=True),
                name="uniq_desktop_exemption_live",
            ),
        ]

    def __str__(self) -> str:
        state = "revoked" if self.revoked_at else "live"
        return f"Browser exemption for user {self.student_id} ({state})"


class DesktopAuthCode(models.Model):
    #: sha256 of the code the browser hands to the app. The code itself is never stored.
    code_hash = models.CharField(max_length=64, unique=True)
    #: base64url(sha256(verifier)) — the PKCE challenge the app sent when it opened the browser.
    challenge = models.CharField(max_length=128)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "desktop_auth_code"
        indexes = [models.Index(fields=["expires_at"], name="desktop_auth_code_exp")]

    def __str__(self) -> str:
        return f"Desktop sign-in code for user {self.user_id}"


class MidtermLockdown(models.Model):
    attempt = models.OneToOneField(
        "midterms.MidtermAttempt",
        on_delete=models.CASCADE,
        related_name="lockdown",
    )
    #: Set the first time the app opens a session on a sitting the rule applies to. From then on
    #: every request about this sitting must carry the session token — unless the student holds
    #: a live exemption, which is read at request time so a teacher can rescue a sitting whose
    #: laptop died.
    required = models.BooleanField(default=False)
    #: sha256 of the single outstanding challenge, and when it stops being accepted.
    nonce_hash = models.CharField(max_length=64, blank=True)
    nonce_expires_at = models.DateTimeField(null=True, blank=True)
    #: sha256 of the live session token. Opening a new session replaces it, which is what
    #: closes the old window (or the second laptop) out.
    session_hash = models.CharField(max_length=64, blank=True)
    session_opened_at = models.DateTimeField(null=True, blank=True)
    #: How many sessions this sitting has needed. More than one means the app was restarted
    #: mid-paper — a crash, a power cut, or a sign-out — which a teacher may want to see.
    sessions_opened = models.PositiveIntegerField(default=0)
    app_version = models.CharField(max_length=32, blank=True)
    key_id = models.CharField(max_length=32, blank=True)
    #: The app's own report of the machine when it locked down (displays, remote session, VM,
    #: closed apps). Evidence, not a decision: the app refuses to lock down a machine that fails.
    precheck = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "desktop_midterm_lockdown"

    def __str__(self) -> str:
        return f"Lockdown for midterm attempt {self.attempt_id}"
