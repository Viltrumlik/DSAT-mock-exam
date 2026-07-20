from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .admin_report import (
    ReportClassroomDetailView,
    ReportClassroomListView,
    ReportMidtermDetailView,
    ReportMidtermPdfView,
)
from .admin_views import AdminMidtermQuestionViewSet, AdminMidtermViewSet
from .views import MidtermAttemptViewSet
from .views_report import MidtermErrorReportPdfView, MidtermErrorReportView
from .views_student import MyMidtermsView
from .views_teacher import (
    MidtermCatalogView,
    MidtermGrantView,
    MidtermRevokeView,
    MidtermStandaloneResultsView,
    MidtermStudentsView,
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
    # Per-student error report — declared ahead of the attempts router so it isn't
    # swallowed by the viewset's detail route.
    path(
        "attempts/<int:pk>/error-report/",
        MidtermErrorReportView.as_view(),
        name="midterm-error-report",
    ),
    path(
        "attempts/<int:pk>/error-report/pdf/",
        MidtermErrorReportPdfView.as_view(),
        name="midterm-error-report-pdf",
    ),
    # Admin console reports (classroom → midterm → student table + PDF).
    path(
        "admin/reports/classrooms/",
        ReportClassroomListView.as_view(),
        name="midterm-report-classrooms",
    ),
    path(
        "admin/reports/classrooms/<int:cid>/",
        ReportClassroomDetailView.as_view(),
        name="midterm-report-classroom",
    ),
    path(
        "admin/reports/classrooms/<int:cid>/midterms/<int:mid>/",
        ReportMidtermDetailView.as_view(),
        name="midterm-report-midterm",
    ),
    path(
        "admin/reports/classrooms/<int:cid>/midterms/<int:mid>/pdf/",
        ReportMidtermPdfView.as_view(),
        name="midterm-report-midterm-pdf",
    ),
    # Teacher standalone-midterm area (grant access + results).
    path("teacher/midterms/", MidtermCatalogView.as_view(), name="midterm-teacher-catalog"),
    path("teacher/students/", MidtermStudentsView.as_view(), name="midterm-teacher-students"),
    path("teacher/midterms/<int:pk>/grant/", MidtermGrantView.as_view(), name="midterm-teacher-grant"),
    path("teacher/midterms/<int:pk>/revoke/", MidtermRevokeView.as_view(), name="midterm-teacher-revoke"),
    path("teacher/midterms/<int:pk>/results/", MidtermStandaloneResultsView.as_view(), name="midterm-teacher-results"),
    # Admin builder — deepest (questions) route first so it isn't shadowed by the base router.
    path("admin/midterms/<int:midterm_pk>/questions/", include(admin_question_router.urls)),
    path("admin/", include(admin_router.urls)),
] + router.urls
