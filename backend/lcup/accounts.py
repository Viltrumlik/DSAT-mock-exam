"""Accounts for lc-up students — and, since 2026-10-13, teachers — who had none on our side.

The account is a normal student (or teacher) whose username *is* the phone — so the existing username login
works with it — and whose password is unusable until they choose one. The first sign-in goes
through ``auth_backend`` (phone + its last four digits), limited by the ``AccountClaim`` made here.

A phone already on another account — in any spelling, "+998 90 …" included — is never reused: two
accounts for one phone would split one student's history in two. That case goes to the admin.
The one exception is a single public account (someone who signed up on the site): its phone moves
to the new learning-center account, and the public one keeps its email or Google sign-in.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import IntegrityError, transaction

from access import constants as acc_const
from users.models import SecurityAuditEvent, User

from .matching import phone_owners
from .models import AccountClaim, LinkStatus
from .phones import normalize_phone, split_lcup_name

#: How long the last-four-digits code works before the admin has to reissue it.
CLAIM_DAYS = 14


def _send_to_review(link, reason: str) -> None:
    link.status = LinkStatus.NEEDS_REVIEW
    link.match_reason = reason
    link.save(update_fields=["status", "match_reason"])


def create_account_for(link, *, now, phone_override: str | None = None) -> User | None:
    phone = normalize_phone(phone_override or link.phone)
    if not phone:
        _send_to_review(link, "phone is not a valid Uzbek number" if phone_override else "no phone in lc-up")
        return None
    if User.objects.filter(username__iexact=phone).exists():
        _send_to_review(link, "phone already used by another account")
        return None
    owners = phone_owners(User.objects.all(), phone)
    if owners and not (len(owners) == 1 and owners[0].role == acc_const.ROLE_PUBLIC_STUDENT):
        _send_to_review(link, "phone already used by another account")
        return None

    try:
        with transaction.atomic():
            if owners:
                # The phone follows the person to their new learning-center account; the public
                # one keeps its email / Google sign-in (owner, 2026-10-13).
                moved = owners[0]
                moved.phone_number = None
                moved.save(update_fields=["phone_number"])
                SecurityAuditEvent.objects.create(
                    user=moved, event_type="lcup_phone_moved", detail={"lcup_student_id": link.lcup_student_id}
                )
            return _claimable_account(link, phone, now=now, role=acc_const.ROLE_STUDENT)
    except IntegrityError:
        # Someone took the username or phone between the check and the insert.
        _send_to_review(link, "phone already used by another account")
        return None


def create_teacher_account_for(link, *, subject: str, now) -> User | None:
    """An account for an lc-up teacher nothing matched (owner, 2026-10-13: "teacher uchun ham yangi
    account ochilaversin"), signed into the way a student's is. ``subject`` is "math" or "english",
    from the lc-up group that needs them.

    Unlike a student's, a phone already on ANY account — a public one included — goes to the admin:
    a teacher's account opens other people's work, so it is never handed a number someone else holds.
    """
    from users.serializers import _sync_global_user_access

    phone = normalize_phone(link.phone)
    if not phone:
        _send_to_review(link, "no phone in lc-up")
        return None
    if User.objects.filter(username__iexact=phone).exists() or phone_owners(User.objects.all(), phone):
        _send_to_review(link, "phone already used by another account")
        return None
    try:
        with transaction.atomic():
            user = _claimable_account(link, phone, now=now, role=acc_const.ROLE_TEACHER, subject=subject)
            # Parity with a teacher the admin creates: the global row for their subject.
            _sync_global_user_access(user)
    except IntegrityError:
        _send_to_review(link, "phone already used by another account")
        return None
    return user


def _claimable_account(link, phone: str, *, now, **fields) -> User:
    """The account, its first-sign-in claim, and the link pointing at it. Inside the caller's atomic."""
    first_name, last_name = split_lcup_name(link.name)
    # password=None makes create_user store an unusable password.
    user = User.objects.create_user(
        None,
        password=None,
        username=phone,
        phone_number=phone,
        first_name=first_name,
        last_name=last_name,
        **fields,
    )
    AccountClaim.objects.create(user=user, phone=phone, expires_at=now + timedelta(days=CLAIM_DAYS))
    link.user = user
    link.status = LinkStatus.CREATED
    link.match_reason = "account created"
    link.save(update_fields=["user", "status", "match_reason"])
    return user


class OneTimePasswordRefused(Exception):
    """Why an account cannot be given a one-time password; the message is shown to the admin."""


def issue_one_time_password(user, *, now) -> AccountClaim:
    """Take the account's password away and let it sign in once more with phone + last four digits.

    Owner, 2026-10-15: "new password kerak emas uning o'rniga … give one time password bo'lsin, shuni
    bosganda yana telefoni 4ta raqamiga qaytsin bir martalik qilib". It is the lc-up first sign-in
    again, reused whole: the password becomes unusable, the claim reopens for ``CLAIM_DAYS``, and the
    completion gate asks for a new password straight after that one sign-in (``claims``).
    """
    from .conf import lcup_enabled

    if not lcup_enabled():
        raise OneTimePasswordRefused("One-time sign-in is turned off.")
    phone = normalize_phone(user.phone_number)
    if not phone:
        raise OneTimePasswordRefused("This account has no phone number. Add one first.")
    # The claim backend looks a phone up among OPEN claims; two open on one phone would be a coin toss.
    if AccountClaim.objects.filter(phone=phone, password_set_at__isnull=True).exclude(user=user).exists():
        raise OneTimePasswordRefused("Another account is waiting to sign in with this phone number.")
    with transaction.atomic():
        user.set_unusable_password()
        user.save(update_fields=["password"])
        claim, created = AccountClaim.objects.get_or_create(
            user=user, defaults={"phone": phone, "expires_at": now + timedelta(days=CLAIM_DAYS)}
        )
        if not created:
            claim.phone = phone
            claim.failed_attempts = 0
            claim.locked_at = None
            claim.first_login_at = None
            claim.password_set_at = None
            claim.expires_at = now + timedelta(days=CLAIM_DAYS)
            claim.reissued_count += 1
            claim.save()
    return claim


def reissue_claim(claim: AccountClaim, *, now) -> AccountClaim:
    claim.failed_attempts = 0
    claim.locked_at = None
    claim.expires_at = now + timedelta(days=CLAIM_DAYS)
    claim.reissued_count += 1
    claim.save(update_fields=["failed_attempts", "locked_at", "expires_at", "reissued_count"])
    return claim
