from django.contrib import admin

from .models import PointAward, PointAwardAudit, RewardRule, RewardSeason


@admin.register(RewardSeason)
class RewardSeasonAdmin(admin.ModelAdmin):
    list_display = ("name", "is_current", "started_at", "ended_at")
    list_filter = ("is_current",)
    search_fields = ("name",)


@admin.register(RewardRule)
class RewardRuleAdmin(admin.ModelAdmin):
    list_display = ("event", "points", "is_active", "updated_at")
    list_filter = ("is_active",)
    list_editable = ("points", "is_active")


class PointAwardAuditInline(admin.TabularInline):
    model = PointAwardAudit
    extra = 0
    can_delete = False
    readonly_fields = ("previous_points", "new_points", "reason", "actor", "created_at")


@admin.register(PointAward)
class PointAwardAdmin(admin.ModelAdmin):
    list_display = ("student", "event", "points", "classroom", "season", "awarded_at")
    list_filter = ("event", "season")
    search_fields = ("student__email", "idempotency_key")
    # The ledger is written by hooks through the award service, which keeps PointAwardAudit in
    # step. Editing a row here would move a balance with no trail, so it is read-only —
    # corrections belong in the ops endpoints.
    readonly_fields = (
        "student", "season", "event", "points", "classroom", "source_type", "source_id",
        "idempotency_key", "awarded_at", "updated_at", "created_by", "note",
    )
    inlines = [PointAwardAuditInline]

    def has_add_permission(self, request):
        return False
