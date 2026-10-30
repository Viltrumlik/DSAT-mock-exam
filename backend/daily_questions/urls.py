from django.urls import path

from .views import AnswerView, TodayView

urlpatterns = [
    path("today/", TodayView.as_view(), name="daily-questions-today"),
    path("<int:assignment_id>/answer/", AnswerView.as_view(), name="daily-questions-answer"),
]
