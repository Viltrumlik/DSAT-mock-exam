from django.conf import settings
from django.db import models
from django.utils import timezone


class CapturedMessage(models.Model):
    """A message the test copy would have sent (``staging.outbound.capture``). Empty everywhere else.

    These rows are the only ones the toolbox ever deletes (Messages → Clear)."""

    class Channel(models.TextChoices):
        SMS = "sms", "SMS"
        TELEGRAM = "telegram", "Telegram"
        EMAIL = "email", "E-mail"
        PUSH = "push", "Push"

    channel = models.CharField(max_length=10, choices=Channel.choices)
    #: The phone, Telegram chat, e-mail address(es) or person it was for. Text: a bulk e-mail names many.
    to = models.TextField(blank=True, default="")
    subject = models.TextField(blank=True, default="")
    body = models.TextField(blank=True, default="")
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.channel} to {self.to}"


class ToolboxAction(models.Model):
    """Who did what in the toolbox, and when: every POST writes one."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=60)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.action} by {self.user_id}"
