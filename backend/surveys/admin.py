from django.contrib import admin

from .models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse


class SurveyQuestionInline(admin.TabularInline):
    model = SurveyQuestion
    extra = 0


@admin.register(Survey)
class SurveyAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "opens_at", "closes_at", "created_at")
    list_filter = ("status",)
    search_fields = ("title",)
    inlines = [SurveyQuestionInline]


class SurveyAnswerInline(admin.TabularInline):
    model = SurveyAnswer
    extra = 0
    readonly_fields = ("question", "value")
    can_delete = False


@admin.register(SurveyResponse)
class SurveyResponseAdmin(admin.ModelAdmin):
    list_display = ("survey", "student", "status", "submitted_at")
    list_filter = ("status", "survey")
    search_fields = ("student__email",)
    # A response is the evidence behind a 40-point award; editing one here would move a
    # balance with no trail.
    readonly_fields = ("survey", "student", "status", "submitted_at")
    inlines = [SurveyAnswerInline]

    def has_add_permission(self, request):
        return False
