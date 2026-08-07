from django.urls import path

from .views import (
    OpenSurveysView,
    SurveyAdminDetailView,
    SurveyAdminListView,
    SurveyDetailView,
    SurveyQuestionDetailView,
    SurveyQuestionsView,
    SurveyRespondView,
    SurveyResponsesView,
)

urlpatterns = [
    # Authoring routes sit above <int:survey_id> so "admin" is never read as an id.
    path("admin/", SurveyAdminListView.as_view(), name="survey-admin-list"),
    path("admin/<int:survey_id>/", SurveyAdminDetailView.as_view(), name="survey-admin-detail"),
    path("admin/<int:survey_id>/questions/", SurveyQuestionsView.as_view(), name="survey-questions"),
    path(
        "admin/<int:survey_id>/questions/<int:question_id>/",
        SurveyQuestionDetailView.as_view(),
        name="survey-question-detail",
    ),
    path("admin/<int:survey_id>/responses/", SurveyResponsesView.as_view(), name="survey-responses"),
    path("open/", OpenSurveysView.as_view(), name="survey-open"),
    path("<int:survey_id>/", SurveyDetailView.as_view(), name="survey-detail"),
    path("<int:survey_id>/respond/", SurveyRespondView.as_view(), name="survey-respond"),
]
