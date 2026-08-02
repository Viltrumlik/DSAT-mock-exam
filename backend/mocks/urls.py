from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .admin_views import AdminMockModuleQuestionViewSet, AdminMockViewSet
from .views import MockAttemptViewSet
from .views_session import JoinMockSessionView, MyMockSessionsView, StaffMockSessionViewSet
from .views_student import MyMocksView

router = DefaultRouter()
router.register(r"attempts", MockAttemptViewSet, basename="mock-attempt")

admin_router = DefaultRouter()
admin_router.register(r"mocks", AdminMockViewSet, basename="admin-mock")
admin_router.register(r"sessions", StaffMockSessionViewSet, basename="admin-mock-session")

admin_question_router = DefaultRouter()
admin_question_router.register(r"", AdminMockModuleQuestionViewSet, basename="admin-mock-question")

urlpatterns = [
    # Student list of available mocks.
    path("mine/", MyMocksView.as_view(), name="mock-my-list"),
    # Invigilated sittings — the student half.
    path("sessions/join/", JoinMockSessionView.as_view(), name="mock-session-join"),
    path("sessions/mine/", MyMockSessionsView.as_view(), name="mock-session-my-list"),
    # Admin builder — deepest (questions) route first so it isn't shadowed by the base router.
    path("admin/mocks/<int:mock_pk>/modules/<int:module_pk>/questions/", include(admin_question_router.urls)),
    path("admin/", include(admin_router.urls)),
] + router.urls
