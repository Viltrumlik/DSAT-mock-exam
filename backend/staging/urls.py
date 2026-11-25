from django.urls import path

from . import views

urlpatterns = [
    path("status/", views.StatusView.as_view(), name="staging-status"),
    path("time/", views.TimeView.as_view(), name="staging-time"),
    path("actions/", views.ActionsView.as_view(), name="staging-actions"),
    path("clock.js", views.clock_js, name="staging-clock"),
    path("groups/", views.GroupsView.as_view(), name="staging-groups"),
    path("people/", views.PeopleView.as_view(), name="staging-people"),
    path("students/", views.StudentsView.as_view(), name="staging-students"),
    path("balance/", views.BalanceView.as_view(), name="staging-balance"),
    path("register/", views.RegisterView.as_view(), name="staging-register"),
    path("tasks/", views.TasksView.as_view(), name="staging-tasks"),
    path("tasks/run/", views.TaskRunView.as_view(), name="staging-task-run"),
    path("messages/", views.MessagesView.as_view(), name="staging-messages"),
    path("messages/clear/", views.MessagesClearView.as_view(), name="staging-messages-clear"),
    path("sign-in-link/", views.SignInLinkView.as_view(), name="staging-sign-in-link"),
    path("sign-in/<str:token>/", views.SignInView.as_view(), name="staging-sign-in"),
]
