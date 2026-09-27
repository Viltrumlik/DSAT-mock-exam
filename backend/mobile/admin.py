from django.contrib import admin

from .models import AppReleasePolicy, ClientDiagnostic
from .policy import forget_policy


@admin.register(AppReleasePolicy)
class AppReleasePolicyAdmin(admin.ModelAdmin):
    list_display = ("platform", "minimum_version", "latest_version", "update_url", "updated_at", "updated_by")
    readonly_fields = ("updated_at", "updated_by")

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)
        # Without this the old policy would keep answering for up to a minute on this node.
        forget_policy(obj.platform)


@admin.register(ClientDiagnostic)
class ClientDiagnosticAdmin(admin.ModelAdmin):
    list_display = ("received_at", "kind", "app_version", "build", "os_version", "device_model", "signature", "user")
    list_filter = ("kind", "platform", "app_version")
    search_fields = ("signature", "message", "install_id", "user__email")
    readonly_fields = [f.name for f in ClientDiagnostic._meta.fields]
    date_hierarchy = "received_at"

    def has_add_permission(self, request):
        # Reports come from phones. One typed in here would describe a crash nobody had.
        return False
