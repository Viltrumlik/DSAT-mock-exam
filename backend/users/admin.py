from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm

from .models import ExamDateOption, User


@admin.register(ExamDateOption)
class ExamDateOptionAdmin(admin.ModelAdmin):
    list_display = ["exam_date", "label", "is_active", "sort_order", "created_at"]
    list_filter = ["is_active"]
    list_editable = ["is_active", "sort_order"]
    ordering = ["sort_order", "exam_date"]
    search_fields = ["label"]


# `role` and `subject` belong in BOTH forms, not just in the admin's fieldsets. A ModelForm
# with an explicit `Meta.fields` silently drops anything missing from it, so listing a field
# in `fieldsets` and forgetting it here renders nothing at all — which is exactly why the
# canonical role was invisible in Django admin.
class CustomUserCreationForm(UserCreationForm):
    class Meta:
        model = User
        fields = ("email", "role", "subject", "system_role", "is_staff", "is_superuser")


class CustomUserChangeForm(UserChangeForm):
    class Meta:
        model = User
        fields = (
            "email",
            "username",
            "first_name",
            "last_name",
            "phone_number",
            "telegram_id",
            "profile_image",
            "sat_exam_date",
            "target_score",
            "role",
            "subject",
            "system_role",
            "is_staff",
            "is_superuser",
        )


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    add_form = CustomUserCreationForm
    form = CustomUserChangeForm
    model = User
    # `role` and `subject` were missing from every fieldset. The admin showed only
    # `system_role` — the legacy FK that the model itself documents as "not used for
    # authorization" — so the field that actually decides what an account can do was
    # invisible and unsettable here. Adding a support_teacher through Django admin was
    # impossible for that reason alone, quite apart from the ops panel hiding the subject.
    list_display = ["email", "phone_number", "role", "subject", "is_staff", "is_active", "is_frozen"]
    list_filter = ("role", "subject", "is_active", "is_frozen", "is_staff", "is_superuser")
    ordering = ["email"]
    fieldsets = (
        (None, {"fields": ("email", "username", "password")}),
        (
            "Personal info",
            {"fields": ("first_name", "last_name", "phone_number", "telegram_id", "profile_image", "sat_exam_date", "target_score", "target_english", "target_math")},
        ),
        (
            "Role & scope",
            {
                "fields": ("role", "subject"),
                "description": (
                    "<b>role</b> is the canonical one — it is what authorization reads. "
                    "<b>teacher</b> and <b>support_teacher</b> require a subject; admin, "
                    "test_admin, test_auditor, super_admin and students must leave it empty."
                ),
            },
        ),
        (
            "Permissions",
            {
                "fields": (
                    # Legacy, kept for DB compatibility. `role` above is the live one.
                    "system_role",
                    "is_active",
                    "is_frozen",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "role",
                    "subject",
                    "system_role",
                    "password1",
                    "password2",
                    "is_frozen",
                    "is_staff",
                    "is_superuser",
                ),
            },
        ),
    )
    search_fields = ("email", "phone_number", "username", "first_name", "last_name")
    autocomplete_fields = ("system_role",)
