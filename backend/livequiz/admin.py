from django.contrib import admin

from .models import (
    GemTransaction,
    GemWallet,
    LiveQuizAnswer,
    LiveQuizParticipant,
    LiveQuizQuestion,
    LiveQuizSession,
)


@admin.register(GemWallet)
class GemWalletAdmin(admin.ModelAdmin):
    """Read-only: a balance moves only through the ledger (``gems.grant`` for a correction)."""

    list_display = ("user", "balance", "updated_at")
    search_fields = ("user__email", "user__first_name", "user__last_name")
    raw_id_fields = ("user",)
    readonly_fields = ("user", "balance", "updated_at")


@admin.register(GemTransaction)
class GemTransactionAdmin(admin.ModelAdmin):
    list_display = ("wallet", "kind", "amount", "balance_after", "item_key", "day", "created_at")
    list_filter = ("kind", "day")
    search_fields = ("wallet__user__email", "item_key")
    raw_id_fields = ("wallet", "session")

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(LiveQuizSession)
class LiveQuizSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "join_code", "status", "classroom", "host", "created_at", "finished_at")
    list_filter = ("status", "created_at")
    search_fields = ("join_code", "classroom__name")
    raw_id_fields = ("classroom", "host", "vocab_set")
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
    raw_id_fields = ("session", "source_word")


@admin.register(LiveQuizAnswer)
class LiveQuizAnswerAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "participant", "question", "is_correct", "points_awarded")
    list_filter = ("is_correct",)
    raw_id_fields = ("session", "participant", "question")
