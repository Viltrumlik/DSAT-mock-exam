"""The SMS panel's routes (``/api/sms/``), all under ``admin/`` and all ``IsGlobalAdmin``. The fixed
``campaigns/preview/`` sits above the ``<int:pk>`` routes."""

from django.urls import path

from . import views

urlpatterns = [
    path("admin/overview/", views.OverviewView.as_view(), name="sms-admin-overview"),
    path("admin/stats/", views.StatsView.as_view(), name="sms-admin-stats"),
    path("admin/messages/", views.MessageListView.as_view(), name="sms-admin-messages"),
    path("admin/messages/export/", views.MessageExportView.as_view(), name="sms-admin-messages-export"),
    path("admin/messages/resend/", views.ResendView.as_view(), name="sms-admin-messages-resend"),
    path(
        "admin/students/<int:user_id>/messages/", views.StudentMessagesView.as_view(), name="sms-admin-student-messages"
    ),
    path("admin/campaigns/", views.CampaignListView.as_view(), name="sms-admin-campaigns"),
    path("admin/campaigns/preview/", views.CampaignPreviewView.as_view(), name="sms-admin-campaign-preview"),
    path("admin/campaigns/<int:pk>/", views.CampaignDetailView.as_view(), name="sms-admin-campaign"),
    path("admin/campaigns/<int:pk>/cancel/", views.CampaignCancelView.as_view(), name="sms-admin-campaign-cancel"),
    path("admin/campaigns/<int:pk>/retry/", views.CampaignRetryView.as_view(), name="sms-admin-campaign-retry"),
    path("admin/settings/", views.SettingsView.as_view(), name="sms-admin-settings"),
    path("admin/debt/preview/", views.DebtPreviewView.as_view(), name="sms-admin-debt-preview"),
    path("admin/debt/send-now/", views.DebtSendNowView.as_view(), name="sms-admin-debt-send-now"),
    path("admin/debt/runs/", views.DebtRunsView.as_view(), name="sms-admin-debt-runs"),
    path("admin/templates/", views.TemplateListView.as_view(), name="sms-admin-templates"),
    path("admin/templates/sync/", views.TemplateSyncView.as_view(), name="sms-admin-templates-sync"),
    path("admin/templates/<int:eskiz_id>/", views.TemplateDetailView.as_view(), name="sms-admin-template"),
    path("admin/test/", views.TestSmsView.as_view(), name="sms-admin-test"),
    path("admin/audience/options/", views.AudienceOptionsView.as_view(), name="sms-admin-audience-options"),
    path("admin/audience/classrooms/", views.AudienceClassroomsView.as_view(), name="sms-admin-audience-classrooms"),
    path("admin/audience/students/", views.AudienceStudentsView.as_view(), name="sms-admin-audience-students"),
]
