"""Read-only views of the lists and of who was dealt what.

The lists are fully automatic (owner, 2026-10-30): nobody edits them, so nothing here does
either. To redo a month's list after fixing questions, run
``manage.py build_daily_question_pools --month YYYY-MM --rebuild``.
"""

from django.contrib import admin

from .models import DailyQuestionAssignment, DailyQuestionPool, DailyQuestionPoolItem


class _ReadOnly(admin.ModelAdmin):
    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class DailyQuestionPoolItemInline(admin.TabularInline):
    model = DailyQuestionPoolItem
    fields = ("rank", "question", "correct_count", "answers_count")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(DailyQuestionPool)
class DailyQuestionPoolAdmin(_ReadOnly):
    list_display = ("month", "subject", "level", "source", "stats_from", "stats_until", "built_at")
    list_filter = ("month", "subject", "level")
    inlines = [DailyQuestionPoolItemInline]


@admin.register(DailyQuestionAssignment)
class DailyQuestionAssignmentAdmin(_ReadOnly):
    list_display = ("date", "student", "subject", "level", "question", "is_correct", "answered_at")
    list_filter = ("date", "subject", "level", "is_correct")
    search_fields = ("student__email", "student__first_name", "student__last_name")
    raw_id_fields = ("student", "question", "pool", "classroom")
