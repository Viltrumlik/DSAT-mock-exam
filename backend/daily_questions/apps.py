from django.apps import AppConfig


class DailyQuestionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "daily_questions"
    verbose_name = "Question of the Day"
