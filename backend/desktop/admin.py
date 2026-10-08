from django.contrib import admin

from .models import DesktopExemption, MidtermLockdown


@admin.register(DesktopExemption)
class DesktopExemptionAdmin(admin.ModelAdmin):
    list_display = ("student", "reason", "granted_by", "created_at", "revoked_at")
    list_filter = ("revoked_at",)
    search_fields = ("student__email", "student__username", "student__first_name", "student__last_name")
    raw_id_fields = ("student", "granted_by", "revoked_by")
    readonly_fields = ("created_at",)


@admin.register(MidtermLockdown)
class MidtermLockdownAdmin(admin.ModelAdmin):
    """Read-only evidence: which sittings were bound to the app, and how often it was reopened."""

    list_display = ("attempt", "required", "sessions_opened", "app_version", "session_opened_at")
    list_filter = ("required", "app_version")
    raw_id_fields = ("attempt",)
    exclude = ("nonce_hash", "session_hash")
    readonly_fields = (
        "attempt", "required", "nonce_expires_at", "session_opened_at", "sessions_opened",
        "app_version", "key_id", "precheck", "created_at", "updated_at",
    )

    def has_add_permission(self, request):
        return False
