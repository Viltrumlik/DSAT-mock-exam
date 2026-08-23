from django.contrib import admin

from .models import Notification, NotificationPreference, PushSubscription


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("id", "recipient", "category", "event", "title", "read_at", "created_at")
    list_filter = ("category", "event", "created_at")
    search_fields = ("title", "body", "recipient__email", "recipient__username")
    readonly_fields = [f.name for f in Notification._meta.fields]

    def has_add_permission(self, request):
        # Notifications are written by `services.notify`, which also fires the realtime hint
        # and queues push. One added here would appear in the bell and nowhere else.
        #
        # This used to leave EVENT_SYSTEM with no producer at all — declared, categorised,
        # rendered, and unreachable. The answer is not to relax this flag but the endpoint
        # that goes through the service properly: POST /api/notifications/broadcast/,
        # super_admin only. See `views.NotificationBroadcastView`.
        return False


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "user_agent", "failed_at", "last_seen_at")
    list_filter = ("failed_at",)
    search_fields = ("user__email", "endpoint")
    readonly_fields = [f.name for f in PushSubscription._meta.fields]

    def has_add_permission(self, request):
        # A subscription is minted by a browser. One typed in here could never be pushed to.
        return False


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "push_enabled", "updated_at")
    search_fields = ("user__email",)
