"""Proof-of-control for an email address: issue a code, then confirm it.

Two operations, both driven by ``users.views``:

``issue_code``    mints a 6-digit code, stores only its hash, and hands the plaintext
                  back exactly once for delivery.
``confirm_code``  checks a submitted code and, on success, writes the address onto the
                  requesting account as verified.

The *transfer* half — taking an address off an account that holds it unverified — is
implemented here but gated behind ``EMAIL_TRANSFER_ENABLED`` (default off) plus three
guards. See ``_release_blocked_reason``.
"""
from __future__ import annotations

import logging
import secrets

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from access import constants as acc_const
from users.email_utils import is_deliverable_email, normalize_email
from users.models import EmailClaim
from users.security_audit import log_security_event

logger = logging.getLogger(__name__)
User = get_user_model()

# Outcome codes returned to the caller. Stable strings — the SPA branches on them.
OK = "ok"
ERR_NO_CLAIM = "no_claim"
ERR_EXPIRED = "expired"
ERR_BURNED = "burned"
ERR_BAD_CODE = "bad_code"
ERR_TAKEN_VERIFIED = "taken_verified"
ERR_TAKEN_UNVERIFIED = "taken_unverified"
ERR_NOT_DELIVERABLE = "not_deliverable"


def transfer_enabled() -> bool:
    return bool(getattr(settings, "EMAIL_TRANSFER_ENABLED", False))


def _generate_code() -> str:
    """Six digits from a CSPRNG. ``randbelow`` avoids the modulo bias of ``%``."""
    return f"{secrets.randbelow(1_000_000):06d}"


def address_holder(target_email: str, *, exclude_pk=None):
    """The account currently holding this address, if any."""
    qs = User.objects.filter(email__iexact=normalize_email(target_email))
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.first()


def _release_blocked_reason(incumbent) -> str | None:
    """Why this account must NOT lose its address, or ``None`` if release is allowed.

    Deliberately short. An account holding exam history is *not* protected — the product
    decision is that an unverified address belongs to whoever can prove they read it,
    regardless of how much work sits behind it. The person keeps their account and every
    result; they sign in with their username instead, and are told so by mail.
    """
    if incumbent.email_verified:
        # They proved control. A later claimant cannot outrank that.
        return "incumbent_verified"
    if str(getattr(incumbent, "role", "") or "").strip().lower() != acc_const.ROLE_STUDENT:
        # Staff addresses are never transferable. Registration already discloses which
        # addresses exist, so a guessable info@/admin@ plus this rule would otherwise be
        # a route into an account that grants Django-admin access.
        return "incumbent_is_staff"
    if not str(getattr(incumbent, "username", "") or "").strip():
        # Losing the address is only survivable because the username still signs them
        # in. With neither, and no password-reset flow anywhere in this codebase, the
        # account becomes unreachable until staff intervene. Verified against production
        # first: 385 of 387 accounts have a username, so this is a narrow safety net
        # rather than a common refusal.
        return "incumbent_has_no_username"
    return None


def issue_code(user, target_email: str) -> tuple[str, str | None, EmailClaim | None]:
    """Mint a claim. Returns ``(status, plaintext_code, claim)``.

    The plaintext exists only in this return value — the row stores a hash — so the
    caller must hand it to the delivery layer immediately and never log it.
    """
    target = normalize_email(target_email)
    if not is_deliverable_email(target):
        return ERR_NOT_DELIVERABLE, None, None

    holder = address_holder(target, exclude_pk=user.pk)
    if holder is not None and holder.email_verified:
        # Someone already proved control. Say so plainly: the requester is
        # authenticated and rate-limited, and public registration already discloses
        # address existence, so withholding it here buys nothing and strands the user.
        return ERR_TAKEN_VERIFIED, None, None

    code = _generate_code()
    claim = EmailClaim.objects.create(
        user=user,
        target_email=target,
        code_hash=make_password(code),
        expires_at=timezone.now() + timezone.timedelta(minutes=EmailClaim.TTL_MINUTES),
    )
    log_security_event(
        user_id=user.pk,
        event_type="email_verify_requested",
        severity="info",
        detail={"target": target, "claim_id": claim.pk},
    )
    return OK, code, claim


def confirm_code(user, target_email: str, code: str) -> tuple[str, dict]:
    """Check a submitted code and, on success, move the address onto ``user``.

    Returns ``(status, detail)``. Everything is re-validated *inside* the row lock:
    the claim may have expired, been burned, or the address may have been taken by
    someone else between request and confirm.
    """
    target = normalize_email(target_email)
    submitted = str(code or "").strip()

    with transaction.atomic():
        # Bare select_for_update: no select_related. ``User.system_role`` is a nullable
        # FK, and a LEFT OUTER JOIN under FOR UPDATE is rejected by Postgres while
        # passing silently on SQLite. Must also stay inside atomic() — ATOMIC_REQUESTS
        # is off, and outside a transaction the lock is a no-op on SQLite and an error
        # on Postgres. Both traps have burned this codebase before.
        claim = (
            EmailClaim.objects.select_for_update()
            .filter(user=user, target_email=target, status=EmailClaim.STATUS_PENDING)
            .order_by("-created_at")
            .first()
        )
        if claim is None:
            return ERR_NO_CLAIM, {}

        if claim.expires_at <= timezone.now():
            claim.status = EmailClaim.STATUS_EXPIRED
            claim.save(update_fields=["status"])
            return ERR_EXPIRED, {}

        if not check_password(submitted, claim.code_hash):
            claim.attempts += 1
            if claim.attempts >= EmailClaim.MAX_ATTEMPTS:
                claim.status = EmailClaim.STATUS_BURNED
            claim.save(update_fields=["attempts", "status"])
            log_security_event(
                user_id=user.pk,
                event_type="email_verify_failed",
                severity="warning",
                detail={"target": target, "attempts": claim.attempts},
            )
            # Same answer whether the claim is now burned: revealing "you have N tries
            # left" is a free oracle for an attacker probing how far they can push.
            return ERR_BAD_CODE, {"attempts_remaining": max(0, EmailClaim.MAX_ATTEMPTS - claim.attempts)}

        # Correct code. Lock the rows we are about to write, lowest pk first so two
        # concurrent swaps cannot deadlock on each other.
        claimant = User.objects.select_for_update(of=("self",)).get(pk=user.pk)
        incumbent = (
            User.objects.select_for_update(of=("self",))
            .filter(email__iexact=target)
            .exclude(pk=claimant.pk)
            .first()
        )

        if incumbent is not None:
            reason = _release_blocked_reason(incumbent)
            if reason is None and not transfer_enabled():
                reason = "transfer_disabled"
            if reason is not None:
                claim.status = EmailClaim.STATUS_REFUSED
                claim.consumed_at = timezone.now()
                claim.save(update_fields=["status", "consumed_at"])
                log_security_event(
                    user_id=claimant.pk,
                    event_type="email_claim_refused",
                    severity="warning",
                    detail={"target": target, "incumbent_id": incumbent.pk, "reason": reason},
                )
                return ERR_TAKEN_UNVERIFIED, {"reason": reason}

            # Donor is written FIRST: Postgres checks the unique index per statement,
            # so writing the claimant first would collide before the donor is cleared.
            released_from = incumbent.email
            User.objects.filter(pk=incumbent.pk).update(
                previous_email=released_from,
                email=None,
                email_verified=False,
                email_verified_at=None,
                email_released_at=timezone.now(),
            )
            log_security_event(
                user_id=incumbent.pk,
                event_type="email_released",
                severity="warning",
                detail={"target": target, "to_user_id": claimant.pk},
            )
            # Told at the address that is being taken away — the last moment it still
            # reaches them. Without this they would type that address at the login page,
            # be told the credentials are wrong, and have no way to work out why or that
            # their username still works. Queued on commit so a delivery failure cannot
            # roll back the transfer.
            transaction.on_commit(
                lambda: _notify_address_released(
                    username=incumbent.username, address=released_from
                )
            )

        User.objects.filter(pk=claimant.pk).update(
            email=target,
            email_verified=True,
            email_verified_at=timezone.now(),
            # Their own previous address, if they had one, stays searchable by staff.
            previous_email=claimant.email or None,
        )
        claim.status = EmailClaim.STATUS_CONFIRMED
        claim.consumed_at = timezone.now()
        claim.save(update_fields=["status", "consumed_at"])
        # Any other pending claim on this address is now moot.
        EmailClaim.objects.filter(
            target_email=target, status=EmailClaim.STATUS_PENDING
        ).exclude(pk=claim.pk).update(status=EmailClaim.STATUS_EXPIRED)

        log_security_event(
            user_id=claimant.pk,
            event_type="email_verify_confirmed",
            severity="info",
            detail={"target": target, "released_from": incumbent.pk if incumbent else None},
        )
        return OK, {"email": target}


def _notify_address_released(*, username: str | None, address: str | None) -> None:
    """Tell the losing account, at the address being taken, how to get back in.

    Best-effort and never raises: the transfer has already committed, and failing to
    send must not surface as an error to the person who legitimately claimed it.
    """
    if not is_deliverable_email(address) or not getattr(settings, "EMAIL_SENDING_ENABLED", False):
        logger.warning("email_release_notice_not_sent target=%s", address)
        return
    try:
        from django.core.mail import EmailMultiAlternatives
        from django.template.loader import render_to_string

        context = {"username": username or "", "address": address}
        text_body = (
            "Your email address was moved\n\n"
            f"{address} has been confirmed on another MasterSAT account, so it is no\n"
            "longer attached to yours.\n\n"
            f"Your account and all of your results are unchanged. Sign in with your\n"
            f"username instead: {username}\n\n"
            "If this was not expected, contact the MasterSAT centre.\n\n"
            "This message was sent automatically; please do not reply to it.\n"
        )
        msg = EmailMultiAlternatives(
            subject="Your MasterSAT sign-in has changed",
            body=text_body,
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
            to=[address],
        )
        msg.attach_alternative(render_to_string("email/address_released.html", context), "text/html")
        msg.send(fail_silently=False)
    except Exception:
        logger.exception("email_release_notice_failed target=%s", address)


def deliver_code(claim: EmailClaim, code: str) -> bool:
    """Hand the code to the mail layer. Returns True when it was actually sent.

    No mail backend is configured yet (Mailgun DNS pending), so this logs the code in
    DEBUG and drops it otherwise, rather than pretending to send. Callers must not
    depend on the return value to decide their HTTP status: telling the client whether
    delivery succeeded is a delivery oracle.
    """
    if not is_deliverable_email(claim.target_email):
        return False

    # Gate on the explicit flag, never on EMAIL_BACKEND: Django defines that (and
    # DEFAULT_FROM_EMAIL, EMAIL_HOST=localhost, EMAIL_PORT=25) whether or not anything
    # is configured, so testing it is always true and would open an SMTP connection to
    # a host with no MTA on every request.
    if not getattr(settings, "EMAIL_SENDING_ENABLED", False):
        # DEBUG logs the code so the flow is exercisable locally with no mail server.
        # Production logs only the claim id — a verification code in the log file is a
        # credential anyone with log access could use.
        if settings.DEBUG:
            logger.warning(
                "email_verify_code_not_sent (EMAIL_SENDING_ENABLED off) target=%s code=%s",
                claim.target_email, code,
            )
        else:
            logger.warning(
                "email_verify_code_not_sent (EMAIL_SENDING_ENABLED off) target=%s claim=%s",
                claim.target_email, claim.pk,
            )
        return False

    from django.core.mail import EmailMultiAlternatives
    from django.template.loader import render_to_string

    context = {"code": code, "ttl_minutes": EmailClaim.TTL_MINUTES}
    # Plain text is the body, HTML the alternative — some clients show only the former,
    # and a code the recipient cannot read is a support ticket.
    text_body = (
        "Confirm your email address\n\n"
        f"Your MasterSAT verification code is {code}.\n"
        f"It expires in {EmailClaim.TTL_MINUTES} minutes.\n\n"
        "If you did not ask to confirm this address, ignore this message — nothing\n"
        "changes until the code is entered.\n\n"
        "This message was sent automatically; please do not reply to it.\n"
    )
    msg = EmailMultiAlternatives(
        subject="Your MasterSAT verification code",
        body=text_body,
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
        to=[claim.target_email],
    )
    try:
        msg.attach_alternative(render_to_string("email/verification_code.html", context), "text/html")
    except Exception:
        # A template problem must not cost the user their code — send the text part.
        logger.exception("email_verify_html_render_failed claim=%s", claim.pk)
    try:
        msg.send(fail_silently=False)
    except Exception:
        # Reported to the caller, which still answers 202: whether delivery succeeded
        # for one address is not something the client may learn.
        logger.exception("email_verify_send_failed claim=%s", claim.pk)
        return False
    return True
