from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .admin_views import AdminMidtermQuestionViewSet, AdminMidtermViewSet
from .views import MidtermAttemptViewSet
from .views_student import MyMidtermsView
from .views_teacher import (
    MidtermCatalogView,
    MidtermGrantView,
    MidtermRevokeView,
    MidtermStandaloneResultsView,
)

router = DefaultRouter()
router.register(r"attempts", MidtermAttemptViewSet, basename="midterm-attempt")

# Admin/builder: midterm definitions + their single module of questions.
admin_router = DefaultRouter()
admin_router.register(r"midterms", AdminMidtermViewSet, basename="admin-midterm")

admin_question_router = DefaultRouter()
admin_question_router.register(r"", AdminMidtermQuestionViewSet, basename="admin-midterm-question")

urlpatterns = [
    # Student list of accessible midterms (both flavors).
    path("mine/", MyMidtermsView.as_view(), name="midterm-my-list"),
    # Teacher standalone-midterm area (grant access + results).
    path("teacher/midterms/", MidtermCatalogView.as_view(), name="midterm-teacher-catalog"),
    path("teacher/midterms/<int:pk>/grant/", MidtermGrantView.as_view(), name="midterm-teacher-grant"),
    path("teacher/midterms/<int:pk>/revoke/", MidtermRevokeView.as_view(), name="midterm-teacher-revoke"),
    path("teacher/midterms/<int:pk>/results/", MidtermStandaloneResultsView.as_view(), name="midterm-teacher-results"),
    # Admin builder — deepest (questions) route first so it isn't shadowed by the base router.
    path("admin/midterms/<int:midterm_pk>/questions/", include(admin_question_router.urls)),
    path("admin/", include(admin_router.urls)),
] + router.urls
