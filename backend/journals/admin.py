from django.contrib import admin

from .models import (
    Journal,
    JournalAuditEvent,
    JournalLesson,
    JournalLessonAssessment,
    JournalLessonAttachment,
)


class JournalLessonInline(admin.TabularInline):
    model = JournalLesson
    extra = 0
    fields = ("lesson_number", "lesson_type", "status", "title")
    readonly_fields = ("lesson_number", "lesson_type")
    ordering = ("lesson_number",)
    show_change_link = True


@admin.register(Journal)
class JournalAdmin(admin.ModelAdmin):
    list_display = ("id", "subject", "level", "status", "total_lessons", "version", "updated_at")
    list_filter = ("subject", "level", "status")
    search_fields = ("title",)
    inlines = [JournalLessonInline]


@admin.register(JournalLesson)
class JournalLessonAdmin(admin.ModelAdmin):
    list_display = ("id", "journal", "lesson_number", "lesson_type", "status", "title")
    list_filter = ("lesson_type", "status", "journal__subject", "journal__level")
    search_fields = ("title", "instructions")


admin.site.register(JournalLessonAssessment)
admin.site.register(JournalLessonAttachment)
admin.site.register(JournalAuditEvent)
