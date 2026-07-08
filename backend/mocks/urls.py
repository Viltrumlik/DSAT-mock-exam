from rest_framework.routers import DefaultRouter

from .views import MockAttemptViewSet

router = DefaultRouter()
router.register(r"attempts", MockAttemptViewSet, basename="mock-attempt")

urlpatterns = router.urls
