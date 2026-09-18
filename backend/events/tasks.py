"""Everything schedulable in this app, and every task registration it owns.

``app.autodiscover_tasks()`` imports exactly one module per app — this one. A ``@shared_task``
defined in ``mail`` is registered only because of the import below; without it the worker
would accept the enqueue and then answer "unregistered task", which is how two mail modules
in this codebase have already been silently dead in production.
"""

from __future__ import annotations

from celery import shared_task

from . import mail  # noqa: F401  (task registration)


@shared_task(name="events.send_due_event_reminders")
def send_due_event_reminders() -> dict:
    from . import services

    return services.send_due_reminders()
