"""Where every outgoing SMS, Telegram message, e-mail and push stops on the test copy.

On the copy (``guard.toolbox_on()``) each sender's choke point writes what it would have sent here and answers as if
it had gone, so the code around it runs as on prod and nobody is reached; the toolbox's Messages shows the rows.
Anywhere else ``captured()`` is False and every sender runs exactly as before.

Nothing from ``staging.models`` is imported at module level: the senders import this module inside their own
functions, at send time, so it must be cheap and must not pull the app registry in early."""

from __future__ import annotations

from .guard import toolbox_on

CHANNELS = frozenset({"sms", "telegram", "email", "push"})


def captured() -> bool:
    """Whether outgoing messages are captured instead of sent: only on the test copy."""
    return toolbox_on()


def capture(channel: str, to: str, body: str, *, subject: str = "", meta: dict | None = None) -> None:
    """One message that would have gone out: ``channel`` is "sms", "telegram", "email" or "push"; ``to`` the phone,
    chat, address or person it was for."""
    if channel not in CHANNELS:
        raise ValueError(f"Unknown channel {channel!r}.")
    from .models import CapturedMessage

    CapturedMessage.objects.create(
        channel=channel, to=str(to or ""), subject=str(subject or ""), body=str(body or ""), meta=dict(meta or {})
    )


def person(user) -> str:
    """Who a push was for, as Messages shows it: the name and the sign-in, so its filter finds either."""
    name = " ".join(f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".split())
    login = str(getattr(user, "username", "") or getattr(user, "email", "") or getattr(user, "pk", ""))
    return f"{name} ({login})" if name else login
