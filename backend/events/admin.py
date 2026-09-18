from django.contrib import admin

from .models import Event, EventRegistration


class RegistrationInline(admin.TabularInline):
    model = EventRegistration
    extra = 0
    readonly_fields = (
        "student", "status", "registered_at", "attendance", "marked_by", "marked_at",
    )
    can_delete = False


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    """A fallback way in. The ops console is where this job is done — see /ops/events."""

    list_display = ("id", "title", "status", "starts_at", "seats", "location")
    list_filter = ("status",)
    search_fields = ("title", "location")
    readonly_fields = (
        "published_at", "cancelled_at", "reminder_sent_at", "created_by", "created_at",
        "updated_at",
    )
    inlines = [RegistrationInline]

    def save_model(self, request, obj, form, change):
        if not change and obj.created_by_id is None:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
