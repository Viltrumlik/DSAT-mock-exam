from rest_framework.routers import DefaultRouter

from .views import MidtermAttemptViewSet

router = DefaultRouter()
router.register(r"attempts", MidtermAttemptViewSet, basename="midterm-attempt")

urlpatterns = router.urls
