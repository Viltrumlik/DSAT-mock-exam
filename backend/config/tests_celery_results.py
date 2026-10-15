"""No process that SENDS a task may subscribe to its result.

Celery's Redis result backend subscribes the sending process to a pub/sub channel per task
(`backend.on_task_call` → `ResultConsumer.consume_from`) unless the result is ignored. That
PubSub is what hung celery beat for up to 46 h and killed gunicorn workers on the 120 s timeout:
redis-py 6.2.0 re-enters its own non-reentrant lock when the PubSub reconnects after a
redis-server restart (redis/redis-py#3640). Nothing here reads a result, so
`CELERY_TASK_IGNORE_RESULT` keeps every sender from ever creating that PubSub.

The setting does not reach every send path on its own. `Task.apply_async` defaults
`ignore_result` from it, but `app.send_task` pops `ignore_result` with a default of False and
never looks at the setting — and beat falls back to `send_task` for any scheduled task missing
from its registry. So these tests drive the real dispatch code (a view's `.delay()` and beat's
own `Scheduler.apply_async`) against prod's backend class, with only the producer mocked.
"""

import gc
from unittest import mock

from celery.backends.redis import RedisBackend
from celery.beat import ScheduleEntry, Scheduler
from django.conf import settings
from django.test import SimpleTestCase

from config.celery import app

# Any dispatched task will do; this one is also on beat's schedule.
TASK_NAME = "classes.tasks.cleanup_stale_homework_storage"


def _worker_registry():
    # What a freshly booted beat/worker knows: autodiscovery only (see
    # classes/tests_task_registration.py for why the ambient registry would lie).
    app.loader.import_default_modules()
    return app.tasks


class SendersNeverSubscribeToResultsTests(SimpleTestCase):
    def setUp(self):
        self.registry = _worker_registry()
        # A producer that publishes nowhere: the send path runs for real up to the wire.
        self.producer = mock.MagicMock(name="producer")

        eager = app.conf.task_always_eager
        app.conf.update(task_always_eager=False)
        self.addCleanup(app.conf.update, task_always_eager=eager)

        # Prod's result backend. Building it opens no connection: the client is lazy.
        self.backend = RedisBackend(app=app, url="redis://127.0.0.1:6379/2")
        for patcher in (
            mock.patch.object(
                type(app), "backend",
                new_callable=mock.PropertyMock, return_value=self.backend,
            ),
            # The call that creates the PubSub. Mocked, so a failing run never dials Redis.
            mock.patch.object(RedisBackend, "on_task_call"),
        ):
            patched = patcher.start()
            self.addCleanup(patcher.stop)
        self.on_task_call = patched

    def test_the_setting_reaches_the_app(self):
        self.assertIs(settings.CELERY_TASK_IGNORE_RESULT, True)
        self.assertIs(app.conf.task_ignore_result, True)

    def test_every_project_task_ignores_its_result(self):
        offenders = sorted(
            name for name, task in self.registry.items()
            if not name.startswith("celery.") and task.ignore_result is not True
        )
        self.assertEqual(
            offenders, [],
            "These tasks would subscribe their sender to a Redis result channel. Nothing reads "
            "a result; drop the explicit ignore_result=False.\n" + "\n".join(offenders),
        )

    def test_a_delay_from_the_web_never_creates_a_pubsub(self):
        # gunicorn's path: `<task>.delay(...)` from a view.
        result = self.registry[TASK_NAME].apply_async(producer=self.producer)

        self.producer.publish.assert_called_once()
        self.on_task_call.assert_not_called()
        self.assertTrue(result.ignored)

        # The hang's first frame was AsyncResult.__del__ → cancel_for → PubSub.unsubscribe.
        # With no PubSub ever created, that path has nothing to lock.
        del result
        gc.collect()
        self.assertIsNone(self.backend.result_consumer._pubsub)

    def test_beat_never_subscribes_for_any_scheduled_task(self):
        # beat's path, per entry: `task.apply_async` when the name is registered, otherwise
        # `send_task` — which ignores the setting. Either way it must not subscribe.
        unregistered = sorted(
            spec["task"] for spec in settings.CELERY_BEAT_SCHEDULE.values()
            if spec["task"] not in self.registry
        )
        self.assertEqual(
            unregistered, [],
            "beat would dispatch these through app.send_task, which subscribes to the result "
            "whatever CELERY_TASK_IGNORE_RESULT says:\n" + "\n".join(unregistered),
        )

        scheduler = Scheduler(app, lazy=True)
        for name, spec in settings.CELERY_BEAT_SCHEDULE.items():
            with self.subTest(entry=name):
                self.producer.reset_mock()
                self.on_task_call.reset_mock()
                entry = ScheduleEntry(
                    name=name, task=spec["task"], schedule=spec["schedule"],
                    args=spec.get("args"), kwargs=spec.get("kwargs"),
                    options=spec.get("options"), app=app,
                )
                scheduler.apply_async(entry, producer=self.producer, advance=False)

                self.producer.publish.assert_called_once()
                self.on_task_call.assert_not_called()

    def test_the_patch_point_is_live(self):
        # Control: a result someone DOES ask for still subscribes — so the assertions above
        # watch the call that creates the PubSub, not a dead hook.
        self.registry[TASK_NAME].apply_async(producer=self.producer, ignore_result=False)

        self.on_task_call.assert_called_once()
