"""Every task the code dispatches must exist in the worker that has to run it.

A `@shared_task` registers when its MODULE is imported. `autodiscover_tasks()` imports one
module per app — `tasks.py` — so a task defined anywhere else is registered only in a process
that happens to import its module for some other reason.

That is not a theoretical gap. `classes.mail_homework.send_homework_assigned_emails` was
imported only inside the two view functions that dispatch it, so the web process could
publish the message and the worker had no such task to run. Nothing raised: the send is
claimed on `Assignment.notified_at` *before* dispatch, so every homework was permanently
marked "announced" while the class was never mailed.

These tests are deliberately about REGISTRATION, not behaviour — the behaviour tests in
tests_homework_email.py all passed throughout, because in tests the task object is called
directly and its module is therefore always imported.
"""

from celery import current_app
from django.test import SimpleTestCase

# Task names this codebase dispatches by name (`.delay()` / `apply_async`) and therefore
# needs a worker to resolve. Add a task here when you add one anywhere outside a `tasks.py`.
DISPATCHED_TASK_NAMES = [
    "classes.mail_homework.send_homework_assigned_emails",
    "classes.mail_midterm.send_midterm_scheduled_emails",
    "classes.tasks.cleanup_stale_homework_storage",
    "classes.tasks.prune_homework_staged_uploads",
]


def _worker_registry() -> set[str]:
    """The task names a freshly booted worker would know.

    `import_default_modules()` is what the worker itself runs at startup — it performs the
    autodiscovery and nothing else. Asking the ambient `current_app.tasks` instead would be
    meaningless: in a test process that is just "whatever happened to get imported", which is
    exactly the accident that hid this bug.
    """
    current_app.loader.import_default_modules()
    return set(current_app.tasks.keys())


class TaskRegistrationTests(SimpleTestCase):
    def test_every_dispatched_task_is_registered(self):
        registered = _worker_registry()
        missing = [n for n in DISPATCHED_TASK_NAMES if n not in registered]
        self.assertEqual(
            missing, [],
            "These tasks are dispatched by name but no worker can resolve them. A task "
            "registers only when its module is imported, and autodiscovery imports just "
            "<app>/tasks.py — import the module there.\nMissing: " + ", ".join(missing),
        )

    def test_the_homework_mail_task_survives_autodiscovery_alone(self):
        # The specific regression: autodiscovery ALONE must register the homework mailer.
        # Before the fix it needed a view module to have been loaded first, which the worker
        # never does.
        self.assertIn(
            "classes.mail_homework.send_homework_assigned_emails",
            _worker_registry(),
            "classes/tasks.py no longer imports mail_homework — the worker will silently "
            "drop every homework-assigned email again.",
        )

    def test_task_names_match_their_declared_name(self):
        # A `@shared_task(name=...)` whose module path drifts from its declared name still
        # registers, but callers importing the function dispatch the DECLARED name. Pin both.
        from classes.mail_homework import send_homework_assigned_emails
        from classes.mail_midterm import send_midterm_scheduled_emails

        self.assertEqual(
            send_homework_assigned_emails.name,
            "classes.mail_homework.send_homework_assigned_emails",
        )
        self.assertEqual(
            send_midterm_scheduled_emails.name,
            "classes.mail_midterm.send_midterm_scheduled_emails",
        )
