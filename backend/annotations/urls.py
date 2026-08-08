from django.urls import path

from .views import AnnotationListView, AnnotationWriteView

urlpatterns = [
    path("", AnnotationListView.as_view(), name="annotation-list"),
    path("write/", AnnotationWriteView.as_view(), name="annotation-write"),
]
