from django.urls import path

from .views import QuestionErrorReportCreateView, TelegramReportWebhookView

urlpatterns = [
    path("reports/", QuestionErrorReportCreateView.as_view(), name="question-report-create"),
    path(
        "telegram/webhook/",
        TelegramReportWebhookView.as_view(),
        name="question-report-telegram-webhook",
    ),
]
