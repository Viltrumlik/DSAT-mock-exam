from django.contrib import admin

from .models import (
    VocabHomework,
    VocabSection,
    VocabSet,
    VocabSetItem,
    VocabStudySession,
    VocabWord,
    VocabWordProgress,
)


class VocabSetInline(admin.TabularInline):
    model = VocabSet
    extra = 0
    fields = ("title", "order")
    ordering = ("order", "id")
    show_change_link = True


class VocabSetItemInline(admin.TabularInline):
    model = VocabSetItem
    extra = 0
    fields = ("word", "order")
    ordering = ("order", "id")
    raw_id_fields = ("word",)


@admin.register(VocabSection)
class VocabSectionAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "slug", "order", "is_published", "created_at")
    list_filter = ("is_published",)
    search_fields = ("title", "slug")
    prepopulated_fields = {"slug": ("title",)}
    inlines = [VocabSetInline]


@admin.register(VocabWord)
class VocabWordAdmin(admin.ModelAdmin):
    list_display = ("id", "word", "section", "part_of_speech")
    list_filter = ("part_of_speech",)
    search_fields = ("word", "definition")
    list_select_related = ("section",)
    raw_id_fields = ("section",)


@admin.register(VocabSet)
class VocabSetAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "section", "owner", "order", "created_at")
    search_fields = ("title",)
    raw_id_fields = ("section", "owner")
    list_select_related = ("section", "owner")
    inlines = [VocabSetItemInline]


@admin.register(VocabWordProgress)
class VocabWordProgressAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "word", "status", "correct_modes", "last_reviewed_at")
    list_filter = ("status",)
    search_fields = ("user__email", "word__word")
    raw_id_fields = ("user", "word")
    list_select_related = ("user", "word")


@admin.register(VocabHomework)
class VocabHomeworkAdmin(admin.ModelAdmin):
    list_display = ("id", "classroom", "assignment", "vocab_set", "assigned_by", "created_at")
    search_fields = ("vocab_set__title", "assignment__title")
    raw_id_fields = ("classroom", "assignment", "vocab_set", "assigned_by")
    list_select_related = ("classroom", "assignment", "vocab_set")


@admin.register(VocabStudySession)
class VocabStudySessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "vocab_set",
        "mode",
        "started_at",
        "completed_at",
        "correct_count",
        "total_count",
        "accuracy",
    )
    list_filter = ("mode",)
    raw_id_fields = ("user", "vocab_set", "homework")
    list_select_related = ("user", "vocab_set")
