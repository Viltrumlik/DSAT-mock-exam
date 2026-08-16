from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ClassroomViewSet,
    JoinClassView,
    ClassPostViewSet,
    AssignmentViewSet,
    SubmissionAdminViewSet,
    ClassCommentListCreateView,
    OpsStatsView,
    OpsAttentionView,
)
from .views_rankings import RankingsView, RankingRecomputeView, RankingConfigView, RankingHistoryView
from .views_attendance import (
    AttendanceSessionsView,
    AttendanceSessionDetailView,
    AttendanceMarkView,
    AttendanceMarkAllPresentView,
    AttendanceFinalizeView,
    AttendanceSummaryView,
    AttendanceMeView,
    AttendanceStudentView,
)
from .views_analytics import AnalyticsClassView, AnalyticsMeView, AnalyticsStudentView
from .views_gradebook import GradebookOverviewView, GradebookAssignmentView
from .views_materials import ClassroomMaterialsView, ClassroomMaterialDetailView
from .views_support import (
    SupportAvailabilityDetailView,
    SupportAvailabilityView,
    SupportBookingDetailView,
    SupportBookingRateView,
    SupportBookingSettleView,
    SupportBookingsView,
    SupportCalendarView,
    SupportDeskOverviewView,
    SupportDeskTeachersView,
    SupportDiaryView,
    SupportHourView,
    SupportRatingsView,
    SupportSlotsView,
    SupportTeacherCalendarView,
)
from .views_assign import (
    AssignMidtermView,
    AssignTeacherView,
    ClassroomGovernanceDeleteView,
    SupportTeacherAssignView,
    TransferOwnershipView,
)
from .views_lessons import (
    ClassroomLessonDetailView,
    ClassroomLessonGrantView,
    ClassroomLessonReleaseView,
    ClassroomLessonRescheduleView,
    ClassroomLessonRevokeView,
    ClassroomLessonsView,
)
from .views_results import ClassroomMidtermResultsView, ClassroomUnifiedResultsView
from .views_org import (
    BranchDetailView,
    BranchListCreateView,
    ClassroomBranchView,
    RegionDetailView,
    RegionListCreateView,
)
from .views_pastpaper_certificates import (
    AttemptErrorReportView,
    PastpaperCertificateDetailView,
    PastpaperCertificateDownloadView,
    PastpaperCertificateReissueView,
    PastpaperErrorReportPdfView,
)
from .views_certificates import (
    IssueMidtermCertificatesView,
    MidtermCertificatesDownloadAllView,
    MidtermCertificateDownloadView,
    MidtermCertificateDetailView,
)
from .views_midterm_panel import MidtermPanelView, MyMidtermsView
from .views_midterm_v2 import (
    AssignMidtermV2View,
    AssignVersionsView,
    ClassroomMidtermsV2ListView,
    IssueMidtermV2CertificatesView,
    MidtermV2CertificatesDownloadAllView,
    MidtermV2PanelView,
    MidtermV2StartCodeView,
)
from .views_roster import MemberManageView, ClassroomRosterView
from .views_media import AssignmentVideoUploadUrlView
from .views_roadmap import StudentRoadmapView


router = DefaultRouter()
router.register(r"", ClassroomViewSet, basename="classroom")

posts_router = DefaultRouter()
posts_router.register(r"", ClassPostViewSet, basename="class-posts")

assignments_router = DefaultRouter()
assignments_router.register(r"", AssignmentViewSet, basename="class-assignments")

submissions_router = DefaultRouter()
submissions_router.register(r"", SubmissionAdminViewSet, basename="class-submissions")


urlpatterns = [
    path("join/", JoinClassView.as_view(), name="class-join"),
    # Student-facing per-subject level ladder. A fixed literal, so it resolves before the
    # router's <int:pk> classroom detail and the collection routes below.
    path("roadmap/", StudentRoadmapView.as_view(), name="student-roadmap"),
    path("ops/stats/", OpsStatsView.as_view(), name="class-ops-stats"),
    path("ops/attention/", OpsAttentionView.as_view(), name="class-ops-attention"),
    path("<int:classroom_pk>/comments/", ClassCommentListCreateView.as_view(), name="class-comments"),
    path("<int:classroom_pk>/members/", ClassroomRosterView.as_view(), name="class-roster"),
    path("<int:classroom_pk>/members/<int:user_id>/", MemberManageView.as_view(), name="class-member-manage"),
    path("<int:classroom_pk>/rankings/recompute/", RankingRecomputeView.as_view(), name="class-rankings-recompute"),
    path("<int:classroom_pk>/rankings/config/", RankingConfigView.as_view(), name="class-rankings-config"),
    path("<int:classroom_pk>/rankings/<str:kind>/history/", RankingHistoryView.as_view(), name="class-rankings-history"),
    path("<int:classroom_pk>/rankings/<str:kind>/", RankingsView.as_view(), name="class-rankings"),
    # Attendance
    path("<int:classroom_pk>/attendance/sessions/", AttendanceSessionsView.as_view(), name="attendance-sessions"),
    path("<int:classroom_pk>/attendance/sessions/<int:session_id>/", AttendanceSessionDetailView.as_view(), name="attendance-session-detail"),
    path("<int:classroom_pk>/attendance/sessions/<int:session_id>/mark/", AttendanceMarkView.as_view(), name="attendance-mark"),
    path("<int:classroom_pk>/attendance/sessions/<int:session_id>/mark-all-present/", AttendanceMarkAllPresentView.as_view(), name="attendance-mark-all-present"),
    path("<int:classroom_pk>/attendance/sessions/<int:session_id>/finalize/", AttendanceFinalizeView.as_view(), name="attendance-finalize"),
    path("<int:classroom_pk>/attendance/summary/", AttendanceSummaryView.as_view(), name="attendance-summary"),
    path("<int:classroom_pk>/attendance/me/", AttendanceMeView.as_view(), name="attendance-me"),
    path("<int:classroom_pk>/attendance/students/<int:student_id>/", AttendanceStudentView.as_view(), name="attendance-student"),
    # Analytics
    path("<int:classroom_pk>/analytics/class/", AnalyticsClassView.as_view(), name="analytics-class"),
    path("<int:classroom_pk>/analytics/me/", AnalyticsMeView.as_view(), name="analytics-me"),
    path("<int:classroom_pk>/analytics/students/<int:student_id>/", AnalyticsStudentView.as_view(), name="analytics-student"),
    # Teacher assignment + admin governance
    path("<int:classroom_pk>/assign-midterm/", AssignMidtermView.as_view(), name="class-assign-midterm"),
    path("<int:classroom_pk>/assign-teacher/", AssignTeacherView.as_view(), name="class-assign-teacher"),
    path("<int:classroom_pk>/transfer-ownership/", TransferOwnershipView.as_view(), name="class-transfer-ownership"),
    # Support teachers are a MEMBERSHIP (ROLE_TA), never the Classroom.teacher FK — routing
    # them through assign-teacher/ would evict the real teacher.
    # Support-teacher booking. Collection routes sit ABOVE the <int:pk> classroom routes
    # so "support" is never parsed as a classroom id.
    path("support/calendar/", SupportCalendarView.as_view(), name="support-calendar"),
    path("support/slots/", SupportSlotsView.as_view(), name="support-slots"),
    path("support/availability/", SupportAvailabilityView.as_view(), name="support-availability"),
    path("support/availability/<int:slot_id>/", SupportAvailabilityDetailView.as_view(), name="support-availability-detail"),
    path("support/bookings/", SupportBookingsView.as_view(), name="support-bookings"),
    path("support/bookings/<int:booking_id>/", SupportBookingDetailView.as_view(), name="support-booking-detail"),
    path("support/bookings/<int:booking_id>/settle/", SupportBookingSettleView.as_view(), name="support-booking-settle"),
    path("support/bookings/<int:booking_id>/rate/", SupportBookingRateView.as_view(), name="support-booking-rate"),
    path("support/my-calendar/", SupportTeacherCalendarView.as_view(), name="support-my-calendar"),
    # <str:action> is constrained to close|open inside the view; a path converter here would
    # 404 a typo instead of saying which actions exist.
    path("support/hours/<str:action>/", SupportHourView.as_view(), name="support-hour-action"),
    path("support/diary/", SupportDiaryView.as_view(), name="support-diary"),
    # Administrator oversight. "desks/teachers/" sits above "desks/" only for readability —
    # both are literal segments, so the order between them does not matter here; what does
    # is that all three stay above the <int:pk> classroom routes below.
    path("support/desks/teachers/", SupportDeskTeachersView.as_view(), name="support-desk-teachers"),
    path("support/desks/", SupportDeskOverviewView.as_view(), name="support-desks"),
    path("support/ratings/", SupportRatingsView.as_view(), name="support-ratings"),
    path("<int:classroom_pk>/branch/", ClassroomBranchView.as_view(), name="class-branch"),
    path("<int:classroom_pk>/support-teachers/", SupportTeacherAssignView.as_view(), name="class-support-teachers"),
    path("<int:classroom_pk>/support-teachers/<int:user_id>/", SupportTeacherAssignView.as_view(), name="class-support-teacher-detail"),
    path("<int:classroom_pk>/governance-delete/", ClassroomGovernanceDeleteView.as_view(), name="class-governance-delete"),
    # Classroom materials (downloadable PDF/DOCX)
    path("<int:classroom_pk>/materials/", ClassroomMaterialsView.as_view(), name="class-materials"),
    path("<int:classroom_pk>/materials/<int:material_id>/", ClassroomMaterialDetailView.as_view(), name="class-material-detail"),
    # Midterm control panel + certificates + scheduling
    path("my-midterms/", MyMidtermsView.as_view(), name="my-midterms"),
    path("certificates/midterm/<str:code>/download/", MidtermCertificateDownloadView.as_view(), name="midterm-certificate-download"),
    path("certificates/midterm/<str:code>/", MidtermCertificateDetailView.as_view(), name="midterm-certificate-detail"),
    # Pastpaper certificates. `download/` above the bare code route, the house rule.
    # Regions and branches. Static "org/" segments sit above anything taking an <int:...>.
    path("org/regions/", RegionListCreateView.as_view(), name="org-regions"),
    path("org/regions/<int:region_id>/", RegionDetailView.as_view(), name="org-region"),
    path("org/branches/", BranchListCreateView.as_view(), name="org-branches"),
    path("org/branches/<int:branch_id>/", BranchDetailView.as_view(), name="org-branch"),
    path("certificates/pastpaper/<str:code>/download/", PastpaperCertificateDownloadView.as_view(), name="pastpaper-certificate-download"),
    path("certificates/pastpaper/<str:code>/", PastpaperCertificateDetailView.as_view(), name="pastpaper-certificate-detail"),
    path("pastpapers/attempts/<int:attempt_id>/report/pdf/", PastpaperErrorReportPdfView.as_view(), name="pastpaper-error-report-pdf"),
    path("pastpapers/attempts/<int:attempt_id>/report/", AttemptErrorReportView.as_view(), name="pastpaper-error-report"),
    path("pastpapers/attempts/<int:attempt_id>/certificate/reissue/", PastpaperCertificateReissueView.as_view(), name="pastpaper-certificate-reissue"),
    path("<int:classroom_pk>/midterms/<int:mock_exam_id>/panel/", MidtermPanelView.as_view(), name="class-midterm-panel"),
    path("<int:classroom_pk>/midterms/<int:mock_exam_id>/certificates/issue/", IssueMidtermCertificatesView.as_view(), name="class-midterm-certificates-issue"),
    path("<int:classroom_pk>/midterms/<int:mock_exam_id>/certificates/download-all/", MidtermCertificatesDownloadAllView.as_view(), name="class-midterm-certificates-download-all"),
    # New separated-midterm (midterms.Midterm) classroom flavor
    path("<int:classroom_pk>/midterms-v2/", ClassroomMidtermsV2ListView.as_view(), name="class-midterm-v2-list"),
    path("<int:classroom_pk>/midterms-v2/assign/", AssignMidtermV2View.as_view(), name="class-midterm-v2-assign"),
    path("<int:classroom_pk>/midterms-v2/<int:midterm_id>/certificates/download-all/", MidtermV2CertificatesDownloadAllView.as_view(), name="class-midterm-v2-download-all"),
    path("<int:classroom_pk>/midterms-v2/<int:midterm_id>/panel/", MidtermV2PanelView.as_view(), name="class-midterm-v2-panel"),
    path("<int:classroom_pk>/midterms-v2/<int:midterm_id>/start-code/", MidtermV2StartCodeView.as_view(), name="class-midterm-v2-start-code"),
    path("<int:classroom_pk>/midterms-v2/<int:midterm_id>/versions/", AssignVersionsView.as_view(), name="class-midterm-v2-versions"),
    path("<int:classroom_pk>/midterms-v2/<int:midterm_id>/certificates/issue/", IssueMidtermV2CertificatesView.as_view(), name="class-midterm-v2-issue"),
    # Journal lesson plan delivered into this classroom (teacher panel). Lives here rather
    # than under /api/journals/ because that namespace is host-guarded to the admin
    # subdomain and its permission class excludes teachers.
    path("<int:classroom_pk>/lessons/", ClassroomLessonsView.as_view(), name="class-lessons"),
    path("<int:classroom_pk>/lessons/reschedule/", ClassroomLessonRescheduleView.as_view(), name="class-lessons-reschedule"),
    path("<int:classroom_pk>/lessons/<int:lesson_id>/", ClassroomLessonDetailView.as_view(), name="class-lesson-detail"),
    path("<int:classroom_pk>/lessons/<int:lesson_id>/release/", ClassroomLessonReleaseView.as_view(), name="class-lesson-release"),
    path("<int:classroom_pk>/lessons/<int:lesson_id>/grant/", ClassroomLessonGrantView.as_view(), name="class-lesson-grant"),
    path("<int:classroom_pk>/lessons/<int:lesson_id>/grants/<int:grant_id>/revoke/", ClassroomLessonRevokeView.as_view(), name="class-lesson-revoke"),
    # Teacher gradebook
    path("<int:classroom_pk>/midterm-results/", ClassroomMidtermResultsView.as_view(), name="class-midterm-results"),
    path("<int:classroom_pk>/results/", ClassroomUnifiedResultsView.as_view(), name="class-unified-results"),
    path("<int:classroom_pk>/gradebook/", GradebookOverviewView.as_view(), name="gradebook-overview"),
    path("<int:classroom_pk>/gradebook/assignments/<int:assignment_id>/", GradebookAssignmentView.as_view(), name="gradebook-assignment"),
    path("submissions/", include(submissions_router.urls)),
    # Presigned R2 upload URL for a homework lesson video (browser uploads direct to R2).
    path(
        "<int:classroom_pk>/assignments/video-upload-url/",
        AssignmentVideoUploadUrlView.as_view(),
        name="class-assignment-video-upload-url",
    ),
    path("<int:classroom_pk>/posts/", include(posts_router.urls)),
    path("<int:classroom_pk>/assignments/", include(assignments_router.urls)),
    path("", include(router.urls)),
]

