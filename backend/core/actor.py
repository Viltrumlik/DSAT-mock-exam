"""Who is doing this, for code that is too far from the request to be handed a user.

Django signals are the only reliable way to catch a model change written from several
places, and ``ClassroomMembership.status`` is written from at least six: the roster PATCH,
the code-less add, the join-code flow, the leave endpoint, the support-teacher unassign, and
the Django admin — plus management commands and migrations. A receiver sees every one.

What a receiver does **not** see is the person. It gets a model instance and nothing else.
So the request is parked here on the way in, and the receiver reads the user back out of it.

**The request is stored, not the user, and that is the whole trick.** This platform
authenticates with JWT through DRF, not with a Django session. At middleware time
``request.user`` is still ``AnonymousUser`` — DRF has not run yet, and will not until the
view is entered. A middleware that read ``request.user`` eagerly would therefore record
*every* API change as a system change, which is worse than useless: it looks like an audit
trail and answers nothing. Holding the request and resolving ``.user`` at the moment a
receiver asks means DRF has long since authenticated, and DRF writes its authenticated user
back onto the underlying ``HttpRequest`` — so the plain attribute is correct by then, under
JWT, under session auth for the Django admin, and under ``force_authenticate`` in tests.

**A thread-local, and the honest limits of one.** Correct under gunicorn's sync workers,
which is what this platform runs: one request, one thread, start to finish. Cleared in a
``finally`` so a raised view cannot leak an actor into the next request on that worker. Empty
in Celery tasks, management commands and migrations — and empty is the right answer there,
because nobody clicked. Recording a stale user would be worse than recording none.

Do not reach for this to make an authorisation decision. It answers "who, for the record",
never "may they". Permissions are resolved in the view, where the request is in scope and
the answer can still be refused.
"""

from __future__ import annotations

import threading

_state = threading.local()


def get_actor():
    """The authenticated user behind the current request, or ``None``.

    Resolved on every call rather than cached: a receiver may fire before or after DRF
    authenticates, and the later answer is the true one.
    """
    request = getattr(_state, "request", None)
    if request is None:
        return None
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    return user


def set_request(request) -> None:
    _state.request = request


def clear_request() -> None:
    _state.request = None


class _StaticRequest:
    """Carries a user for callers that have one but no request — tests, and management
    commands that legitimately act on somebody's behalf."""

    def __init__(self, user):
        self.user = user


def set_actor(user) -> None:
    """Publish a user directly. Prefer the middleware; this is for code with no request."""
    set_request(_StaticRequest(user) if user is not None else None)


def clear_actor() -> None:
    clear_request()


class CurrentActorMiddleware:
    """Park the request so signal receivers can find out who is behind it.

    Position in the stack barely matters — the user is read lazily, so this only has to wrap
    the view. It sits next to the authentication middleware for readability.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        set_request(request)
        try:
            return self.get_response(request)
        finally:
            # A view that raises must not leave its request attached to this worker thread,
            # where the next one would inherit it and be attributed to a stranger.
            clear_request()
