"""Accounts for lc-up students who had none on our side.

The account is a normal student whose username *is* the phone — so the existing username login
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

    first_name, last_name = split_lcup_name(link.name)
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
            # password=None makes create_user store an unusable password.
            user = User.objects.create_user(
                None,
                password=None,
                username=phone,
                phone_number=phone,
                first_name=first_name,
                last_name=last_name,
                role=acc_const.ROLE_STUDENT,
            )
            AccountClaim.objects.create(user=user, phone=phone, expires_at=now + timedelta(days=CLAIM_DAYS))
            link.user = user
            link.status = LinkStatus.CREATED
            link.match_reason = "account created"
            link.save(update_fields=["user", "status", "match_reason"])
    except IntegrityError:
        # Someone took the username or phone between the check and the insert.
        _send_to_review(link, "phone already used by another account")
        return None
    return user


def reissue_claim(claim: AccountClaim, *, now) -> AccountClaim:
    claim.failed_attempts = 0
    claim.locked_at = None
    claim.expires_at = now + timedelta(days=CLAIM_DAYS)
    claim.reissued_count += 1
    claim.save(update_fields=["failed_attempts", "locked_at", "expires_at", "reissued_count"])
    return claim
