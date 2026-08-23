"""Stories: the ring of circles across the top of a student's dashboard.

**One announcement channel, school-wide.** A story is not addressed to a classroom, a branch
or a subject — everybody signed in sees the same rail. That is the school's decision and it
is also the smaller one to reverse: adding an audience later is a nullable FK and one extra
`.filter()` inside `StoryQuerySet.live()`, whereas launching with targeting would mean the
admin has to answer "who is this for?" before they can post the notice that everyone needs.

**Image only, and the image is the story.** No video, no rich text. The picture carries the
message, the title is the word under the circle, and the caption is what you read once you
have opened it. That keeps the poster's job to "upload the flyer you already made".

**Nothing here records who has watched what.** There is no StoryView table and no per-student
seen state this pass, so every student sees an identical, unread-looking rail. That is a real
limitation — the Instagram grey/colour ring cannot be drawn from this data — and it is a
deliberate one: seen state is a row per student per story, which is the single most expensive
table this feature could grow, and nobody has yet asked for the ring. When somebody does, it
attaches as a new model with an FK to Story; no field here has to change.

**Publish window instead of a delete.** A poster who is putting up a notice for next Friday's
mock should be able to schedule it and forget it, and an expired notice should fall off the
rail on its own rather than waiting for somebody to remember to untick it. Both ends are
optional — see `live_window()` for exactly what a null means at each end.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


def live_window(now=None) -> Q:
    """The one and only definition of "showing on the rail right now".

    It lives here as a `Q` rather than inside the queryset method so that there is a single
    expression to read, to test, and to change — the student rail, the ops console's "is this
    up?" column and anything added later all resolve to this object.

    The null semantics, which are the whole point of the window being optional:

    * ``starts_at`` null → **live since forever**. Post it and it is up immediately; this is
      the ordinary case, and demanding a start time for "put this up now" would be a form
      field that is wrong more often than it is right.
    * ``ends_at`` null → **never expires**. It stays until somebody unticks `is_active`.

    ``ends_at`` is compared with a strict ``__gt``: a story whose end has arrived is over, not
    still showing for the width of one more second. ``starts_at`` uses ``__lte`` for the
    mirror-image reason — a story scheduled for 09:00 is up at 09:00.
    """
    now = now or timezone.now()
    return (
        Q(is_active=True)
        & (Q(starts_at__isnull=True) | Q(starts_at__lte=now))
        & (Q(ends_at__isnull=True) | Q(ends_at__gt=now))
    )


class StoryQuerySet(models.QuerySet):
    def live(self, now=None):
        """Only the stories a student should be shown at ``now`` (default: this instant).

        Every consumer goes through here. The temptation with a publish window is to write
        `filter(is_active=True)` in the student view and "handle the dates in the template",
        at which point the ops console and the dashboard disagree about what is up — so the
        filter is not open-coded anywhere, including in this app.
        """
        return self.filter(live_window(now))


class Story(models.Model):
    objects = StoryQuerySet.as_manager()

    # Plain ImageField and a plain multipart POST, exactly like `shop.ShopItem.image`. The
    # presigned-upload path next door exists for 2 GB lesson videos (classes/media_uploads.py);
    # a story image is a flyer, and nginx already allows 60M on /api/.
    image = models.ImageField(upload_to="stories/", null=True, blank=True)

    title = models.CharField(
        max_length=80, help_text="The word or two under the circle. Keep it short — it wraps.",
    )
    caption = models.TextField(
        blank=True, default="",
        help_text="Shown inside the viewer, under the image. Optional.",
    )
    link_url = models.URLField(
        max_length=500, blank=True, default="",
        help_text="Optional: tapping the story opens this.",
    )

    is_active = models.BooleanField(
        default=True, db_index=True,
        help_text="Unticked pulls it off the rail without deleting it or its image.",
    )
    sort_order = models.IntegerField(default=0, help_text="Lower shows first (leftmost).")

    # Both ends optional; see `live_window` for what each null means.
    starts_at = models.DateTimeField(
        null=True, blank=True, help_text="Leave empty to put it up straight away.",
    )
    ends_at = models.DateTimeField(
        null=True, blank=True, help_text="Leave empty and it stays up until you untick it.",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "stories"
        # `sort_order` first so an administrator can pin a notice to the front, then newest
        # first inside a tie — which is what happens by default, since nobody sets
        # `sort_order` on a story they are posting today.
        ordering = ["sort_order", "-created_at"]
        verbose_name_plural = "stories"
        indexes = [models.Index(fields=["is_active", "sort_order"])]

    def __str__(self) -> str:
        return self.title
