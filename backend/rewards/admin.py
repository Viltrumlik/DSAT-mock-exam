from django.contrib import admin

from .models import PointAward, PointAwardAudit, RewardRule, RewardSeason


@admin.register(RewardSeason)
class RewardSeasonAdmin(admin.ModelAdmin):
    list_display = ("name", "is_current", "started_at", "ended_at")
    list_filter = ("is_current",)
    search_fields = ("name",)


@admin.register(RewardRule)
class RewardRuleAdmin(admin.ModelAdmin):
    # `grants_xp` is editable here on purpose: it is the school's undo for "XP follows points
    # everywhere", and the whole reason it is a column rather than a constant is so taking an
    # event back out of XP costs a checkbox instead of a deploy.
    list_display = ("event", "points", "grants_xp", "is_active", "updated_at")
    list_filter = ("is_active", "grants_xp")
    list_editable = ("points", "grants_xp", "is_active")


class PointAwardAuditInline(admin.TabularInline):
    model = PointAwardAudit
    extra = 0
    can_delete = False
    # Every column, including the XP pair: this table is append-only history written by the
    # award service. A field left out renders as an editable input, which invites somebody to
    # retype a student's past — and an audit row that can be edited proves nothing.
    readonly_fields = (
        "previous_points", "new_points", "previous_xp", "new_xp", "reason", "actor",
        "created_at",
    )


@admin.register(PointAward)
class PointAwardAdmin(admin.ModelAdmin):
    list_display = ("student", "event", "points", "xp", "classroom", "season", "awarded_at")
    list_filter = ("event", "season")
    search_fields = ("student__email", "idempotency_key")
    # The ledger is written by hooks through the award service, which keeps PointAwardAudit in
    # step. Editing a row here would move a balance with no trail, so it is read-only —
    # corrections belong in the ops endpoints. `xp` most of all: it is the one number the
    # platform promises never to take away except by revoking the fact behind it.
    readonly_fields = (
        "student", "season", "event", "points", "xp", "classroom", "source_type", "source_id",
        "idempotency_key", "awarded_at", "updated_at", "created_by", "note",
    )
    inlines = [PointAwardAuditInline]

    def has_add_permission(self, request):
        return False
