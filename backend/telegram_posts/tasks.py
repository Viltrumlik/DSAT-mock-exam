"""Every task this app owns. ``app.autodiscover_tasks()`` imports exactly this module."""

from __future__ import annotations

from celery import shared_task


@shared_task(name="telegram_posts.sweep")
def sweep_group_posts() -> dict:
    from . import sender

    return sender.sweep()


@shared_task(name="telegram_posts.send_now")
def send_group_post_now(post_id: int) -> dict:
    from . import sender

    return sender.send_post_now(post_id)


@shared_task(name="telegram_posts.send_run")
def send_group_post_run(post_id: int, run_on: str) -> dict:
    from datetime import date

    from . import sender

    return sender.send_run(post_id, date.fromisoformat(run_on))
