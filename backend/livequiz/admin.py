from django.contrib import admin

from .models import LiveQuizAnswer, LiveQuizParticipant, LiveQuizQuestion, LiveQuizSession


@admin.register(LiveQuizSession)
class LiveQuizSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "join_code", "status", "classroom", "host", "created_at", "finished_at")
    list_filter = ("status", "created_at")
    search_fields = ("join_code", "classroom__name")
    raw_id_fields = ("classroom", "host", "assessment_set")
    readonly_fields = ("version", "created_at", "updated_at")


@admin.register(LiveQuizParticipant)
class LiveQuizParticipantAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "display_name", "status", "score", "rank", "last_seen_at")
    list_filter = ("status",)
    search_fields = ("display_name",)
    raw_id_fields = ("session", "user")


@admin.register(LiveQuizQuestion)
class LiveQuizQuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "order", "question_type", "points")
    raw_id_fields = ("session", "source_question")


@admin.register(LiveQuizAnswer)
class LiveQuizAnswerAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "participant", "question", "is_correct", "points_awarded")
    list_filter = ("is_correct",)
    raw_id_fields = ("session", "participant", "question")
