from django.urls import path

from . import views

urlpatterns = [
    path("status/", views.StatusView.as_view(), name="lcup-status"),
    path("sync/", views.SyncView.as_view(), name="lcup-sync"),
    path("review-done/", views.ReviewDoneView.as_view(), name="lcup-review-done"),
    path("groups/", views.GroupListView.as_view(), name="lcup-groups"),
    path("groups/<int:pk>/confirm/", views.GroupConfirmView.as_view(), name="lcup-group-confirm"),
    path("groups/<int:pk>/create-class/", views.GroupCreateClassView.as_view(), name="lcup-group-create-class"),
    path("groups/<int:pk>/ignore/", views.GroupIgnoreView.as_view(), name="lcup-group-ignore"),
    path("students/", views.StudentListView.as_view(), name="lcup-students"),
    path("students/<int:pk>/link/", views.StudentLinkView.as_view(), name="lcup-student-link"),
    path("students/<int:pk>/create-account/", views.StudentCreateAccountView.as_view(), name="lcup-student-create-account"),
    path("students/<int:pk>/ignore/", views.StudentIgnoreView.as_view(), name="lcup-student-ignore"),
    path("teachers/", views.TeacherListView.as_view(), name="lcup-teachers"),
    path("teachers/<int:pk>/link/", views.TeacherLinkView.as_view(), name="lcup-teacher-link"),
    path("teachers/<int:pk>/ignore/", views.TeacherIgnoreView.as_view(), name="lcup-teacher-ignore"),
    path("unlinked-members/", views.UnlinkedMembersView.as_view(), name="lcup-unlinked-members"),
    path("accounts/", views.AccountListView.as_view(), name="lcup-accounts"),
    path("accounts/<int:user_id>/reissue/", views.AccountReissueView.as_view(), name="lcup-account-reissue"),
    path("claim/password/", views.ClaimPasswordView.as_view(), name="lcup-claim-password"),
    path("claim/phone/", views.ClaimPhoneView.as_view(), name="lcup-claim-phone"),
    path("attendance/pushes/", views.AttendancePushListView.as_view(), name="lcup-attendance-pushes"),
]
