from django.contrib import admin

from .models import Story


@admin.register(Story)
class StoryAdmin(admin.ModelAdmin):
    """A second, always-available way to post a story.

    The ops console is the surface the school will actually use, but /django-admin/ costs
    nothing to wire up and is the fallback when the console is mid-deploy or somebody needs to
    pull a story down from a phone. Everything an administrator can set from the console is
    editable here too, deliberately — there is no state a story reaches by any route other
    than somebody typing it.
    """

    list_display = ("id", "title", "is_active", "sort_order", "starts_at", "ends_at", "created_at")
    list_filter = ("is_active", "created_at")
    search_fields = ("title", "caption")
    # Straight from the changelist: taking a story down and reordering the rail are the two
    # things that are urgent, and both should be one click away rather than behind a form.
    list_editable = ("is_active", "sort_order")
    readonly_fields = ("created_by", "created_at", "updated_at")

    fieldsets = (
        (None, {"fields": ("image", "title", "caption", "link_url")}),
        (
            "Publishing",
            {
                "fields": ("is_active", "sort_order", "starts_at", "ends_at"),
                "description": (
                    "Leave both times empty and the story is up from now until you untick "
                    "Is active. An empty start means it is live already; an empty end means "
                    "it never expires."
                ),
            },
        ),
        ("Audit", {"fields": ("created_by", "created_at", "updated_at")}),
    )

    def save_model(self, request, obj, form, change):
        # Stamp the poster on creation only. On an edit `created_by` still means "who put this
        # up", not "who last touched it", which is what `updated_at` is for.
        if not change and obj.created_by_id is None:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
