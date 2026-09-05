from django.contrib import admin

from .models import (
    Branch,
    Classroom,
    ClassroomMembership,
    ClassPost,
    Assignment,
    Submission,
    SubmissionFile,
    SubmissionReview,
    SubmissionAuditEvent,
    StaleStorageBlob,
    ClassroomStreamItem,
    ClassComment,
    ClassroomTelegramEvent,
    ClassroomTelegramMember,
    Region,
)


@admin.register(Region)
class RegionAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "code", "is_active", "created_at")
    search_fields = ("name", "code")
    list_filter = ("is_active",)


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "region", "code", "is_active", "created_at")
    search_fields = ("name", "code", "region__name")
    list_filter = ("is_active", "region")
    # Editable on purpose, unlike the reward ledger: this is reference data a school
    # administrator maintains, not a record of something that happened.


@admin.register(Classroom)
class ClassroomAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "subject", "branch", "lesson_days", "lesson_time", "room_number", "join_code", "is_active", "created_at")
    search_fields = ("name", "subject", "lesson_time", "room_number", "join_code", "branch__name")
    list_filter = ("is_active", "branch", "created_at")
    # `branch` is on `list_display` and `list_filter` because assigning it is the whole point
    # — an unassigned classroom is invisible to every branch board, and this list is where a
    # school administrator will notice.


@admin.register(ClassroomMembership)
class ClassroomMembershipAdmin(admin.ModelAdmin):
    list_display = ("id", "classroom", "user", "role", "joined_at")
    search_fields = ("classroom__name", "user__email", "user__username")
    list_filter = ("role", "joined_at")


@admin.register(ClassPost)
class ClassPostAdmin(admin.ModelAdmin):
    list_display = ("id", "classroom", "author", "created_at")
    search_fields = ("classroom__name", "author__email")
    list_filter = ("created_at",)


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ("id", "classroom", "title", "due_at", "created_at")
    search_fields = ("title", "classroom__name")
    list_filter = ("created_at",)


@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):
    list_display = ("id", "assignment", "student", "status", "submitted_at", "updated_at")
    search_fields = ("assignment__title", "student__email")
    list_filter = ("status", "submitted_at")


@admin.register(SubmissionFile)
class SubmissionFileAdmin(admin.ModelAdmin):
    list_display = ("id", "submission", "file_name", "created_at")
    search_fields = ("file_name", "submission__assignment__title", "submission__student__email")


@admin.register(SubmissionReview)
class SubmissionReviewAdmin(admin.ModelAdmin):
    list_display = ("id", "submission", "teacher", "grade", "reviewed_at")
    search_fields = ("submission__assignment__title", "submission__student__email", "teacher__email")
    list_filter = ("reviewed_at",)


@admin.register(StaleStorageBlob)
class StaleStorageBlobAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "storage_name",
        "retry_count",
        "consecutive_failures",
        "last_attempt_at",
        "created_at",
    )
    search_fields = ("storage_name", "reason", "last_error")
    readonly_fields = (
        "storage_name",
        "reason",
        "retry_count",
        "consecutive_failures",
        "last_error",
        "last_attempt_at",
        "alert_logged_at",
        "created_at",
    )
    ordering = ("-created_at",)


@admin.register(SubmissionAuditEvent)
class SubmissionAuditEventAdmin(admin.ModelAdmin):
    list_display = ("id", "submission", "event_type", "actor", "created_at")
    list_filter = ("event_type", "created_at")
    search_fields = ("submission__assignment__title", "submission__student__email")
    readonly_fields = ("submission", "actor", "event_type", "payload", "created_at")
    ordering = ("-created_at",)


@admin.register(ClassroomStreamItem)
class ClassroomStreamItemAdmin(admin.ModelAdmin):
    list_display = ("id", "classroom", "stream_type", "related_id", "actor", "created_at")
    list_filter = ("stream_type", "created_at")
    search_fields = ("classroom__name",)


@admin.register(ClassComment)
class ClassCommentAdmin(admin.ModelAdmin):
    list_display = ("id", "classroom", "target_type", "target_id", "author", "created_at")
    list_filter = ("target_type", "created_at")
    search_fields = ("content", "author__email", "classroom__name")



@admin.register(ClassroomTelegramMember)
class ClassroomTelegramMemberAdmin(admin.ModelAdmin):
    list_display = (
        "id", "classroom", "user", "telegram_username", "status", "removed_reason",
        "joined_at", "observed_arrival_at", "last_checked_at",
    )
    # ``observed_arrival_at`` is null for everybody who was in the group before the bot
    # started watching it, and the bot never removes those people. Filterable because
    # "show me the ones nothing will act on" is the question staff actually arrive with.
    list_filter = ("status", "removed_reason", ("observed_arrival_at", admin.EmptyFieldListFilter))
    search_fields = (
        "classroom__name", "user__email", "user__username", "telegram_username",
        "telegram_user_id",
    )
    # Read-only throughout: every field here is a fact reported by Telegram or written by
    # the bot. Editing one by hand would make the row disagree with the group without
    # changing the group, which is worse than leaving it wrong.
    readonly_fields = tuple(f.name for f in ClassroomTelegramMember._meta.fields)
    ordering = ("-updated_at",)


@admin.register(ClassroomTelegramEvent)
class ClassroomTelegramEventAdmin(admin.ModelAdmin):
    list_display = (
        "id", "created_at", "action", "classroom_name", "user_name", "telegram_user_id", "reason",
    )
    list_filter = ("action", "reason", "created_at")
    search_fields = ("classroom_name", "user_name", "telegram_user_id", "detail")
    readonly_fields = tuple(f.name for f in ClassroomTelegramEvent._meta.fields)
    ordering = ("-created_at",)
