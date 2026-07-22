from django.contrib import admin

from .models import QuestionErrorReport, TelegramReportSubscriber


@admin.register(QuestionErrorReport)
class QuestionErrorReportAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "resource_type",
        "resource_title",
        "question_order",
        "category",
        "status",
        "reporter",
        "created_at",
    )
    list_filter = ("status", "resource_type", "category", "system")
    search_fields = ("resource_title", "question_excerpt", "qb_id", "message")
    list_select_related = ("reporter",)
    date_hierarchy = "created_at"
    ordering = ("-created_at",)
    # The reported target + snapshot are immutable evidence; only the triage fields
    # (status / resolution_note / resolved_by) are editable.
    readonly_fields = (
        "system",
        "question_id",
        "attempt_id",
        "resource_type",
        "resource_id",
        "resource_title",
        "subject",
        "module_label",
        "question_order",
        "question_excerpt",
        "qb_id",
        "category",
        "message",
        "reporter",
        "resolved_by_label",
        "telegram_messages",
        "created_at",
        "updated_at",
    )
    actions = ("mark_reviewing", "mark_fixed", "mark_rejected")

    @admin.action(description="Mark selected as Reviewing")
    def mark_reviewing(self, request, queryset):
        queryset.update(status=QuestionErrorReport.STATUS_REVIEWING)

    @admin.action(description="Mark selected as Fixed")
    def mark_fixed(self, request, queryset):
        queryset.update(status=QuestionErrorReport.STATUS_FIXED, resolved_by=request.user)

    @admin.action(description="Mark selected as Rejected")
    def mark_rejected(self, request, queryset):
        queryset.update(status=QuestionErrorReport.STATUS_REJECTED, resolved_by=request.user)


@admin.register(TelegramReportSubscriber)
class TelegramReportSubscriberAdmin(admin.ModelAdmin):
    list_display = ("chat_id", "username", "first_name", "is_active", "created_at")
    list_filter = ("is_active",)
    search_fields = ("chat_id", "username", "first_name")
    ordering = ("-created_at",)
