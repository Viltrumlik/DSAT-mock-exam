from django.urls import path

from .views import (
    OpenSurveysView,
    SurveyAdminDetailView,
    SurveyAdminListView,
    SurveyDetailView,
    SurveyQuestionDetailView,
    SurveyQuestionReorderView,
    SurveyQuestionsView,
    SurveyRespondView,
    SurveyResponsesCsvView,
    SurveyResponsesView,
)

urlpatterns = [
    # Authoring routes sit above <int:survey_id> so "admin" is never read as an id.
    path("admin/", SurveyAdminListView.as_view(), name="survey-admin-list"),
    path("admin/<int:survey_id>/", SurveyAdminDetailView.as_view(), name="survey-admin-detail"),
    path("admin/<int:survey_id>/questions/", SurveyQuestionsView.as_view(), name="survey-questions"),
    # Above <int:question_id>, or "reorder" is read as a question id.
    path(
        "admin/<int:survey_id>/questions/reorder/",
        SurveyQuestionReorderView.as_view(),
        name="survey-questions-reorder",
    ),
    path(
        "admin/<int:survey_id>/questions/<int:question_id>/",
        SurveyQuestionDetailView.as_view(),
        name="survey-question-detail",
    ),
    path("admin/<int:survey_id>/responses/", SurveyResponsesView.as_view(), name="survey-responses"),
    path(
        "admin/<int:survey_id>/responses.csv",
        SurveyResponsesCsvView.as_view(),
        name="survey-responses-csv",
    ),
    path("open/", OpenSurveysView.as_view(), name="survey-open"),
    path("<int:survey_id>/", SurveyDetailView.as_view(), name="survey-detail"),
    path("<int:survey_id>/respond/", SurveyRespondView.as_view(), name="survey-respond"),
]
