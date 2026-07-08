from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .admin_views import AdminMockModuleQuestionViewSet, AdminMockViewSet
from .views import MockAttemptViewSet

router = DefaultRouter()
router.register(r"attempts", MockAttemptViewSet, basename="mock-attempt")

admin_router = DefaultRouter()
admin_router.register(r"mocks", AdminMockViewSet, basename="admin-mock")

admin_question_router = DefaultRouter()
admin_question_router.register(r"", AdminMockModuleQuestionViewSet, basename="admin-mock-question")

urlpatterns = [
    # Admin builder — deepest (questions) route first so it isn't shadowed by the base router.
    path("admin/mocks/<int:mock_pk>/modules/<int:module_pk>/questions/", include(admin_question_router.urls)),
    path("admin/", include(admin_router.urls)),
] + router.urls
