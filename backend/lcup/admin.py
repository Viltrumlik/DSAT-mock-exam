"""Read-only views of the lc-up tables. The work — pairing, review, reissuing — happens in
``/ops/lcup``, which goes through the same services the sync uses; editing a link row here by
hand would skip them."""

from django.contrib import admin

from .models import (
    AccountClaim,
    LcupFilialLink,
    LcupGroupLink,
    LcupMembership,
    LcupState,
    LcupStudentLink,
    LcupSyncRun,
    LcupTeacherLink,
)


class _ReadOnly(admin.ModelAdmin):
    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(LcupState)
class LcupStateAdmin(_ReadOnly):
    list_display = ("id", "initial_review_done_at", "initial_review_done_by")


@admin.register(LcupFilialLink)
class LcupFilialLinkAdmin(_ReadOnly):
    list_display = ("lcup_filial_id", "name", "branch", "last_seen_at")


@admin.register(LcupTeacherLink)
class LcupTeacherLinkAdmin(_ReadOnly):
    list_display = ("lcup_teacher_id", "name", "user", "status", "match_reason")
    list_filter = ("status",)
    search_fields = ("name", "phone")


@admin.register(LcupStudentLink)
class LcupStudentLinkAdmin(_ReadOnly):
    list_display = ("lcup_student_id", "name", "user", "status", "match_reason")
    list_filter = ("status",)
    search_fields = ("name", "phone")


@admin.register(LcupGroupLink)
class LcupGroupLinkAdmin(_ReadOnly):
    list_display = ("lcup_group_id", "name", "classroom", "status", "suggestion_score", "deleted_in_lcup_at")
    list_filter = ("status",)
    search_fields = ("name",)


@admin.register(LcupMembership)
class LcupMembershipAdmin(_ReadOnly):
    list_display = ("group", "student", "lcup_status", "left_at")
    list_filter = ("lcup_status",)


@admin.register(AccountClaim)
class AccountClaimAdmin(_ReadOnly):
    list_display = ("user", "phone", "expires_at", "failed_attempts", "locked_at", "first_login_at", "password_set_at")


@admin.register(LcupSyncRun)
class LcupSyncRunAdmin(_ReadOnly):
    list_display = ("started_at", "finished_at", "dry_run", "ok")
    list_filter = ("ok", "dry_run")
