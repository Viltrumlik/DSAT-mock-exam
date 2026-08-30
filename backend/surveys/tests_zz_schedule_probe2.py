"""TEMP PROBE 2 — delete after running. WHO can reach /django-admin/ to set the window?"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from access import constants as C
from surveys.models import Survey
from users.utils_staff import sync_django_staff_flag

User = get_user_model()


class WhoCanUseDjangoAdmin(TestCase):
    def setUp(self):
        self.survey = Survey.objects.create(title="End of term", status=Survey.STATUS_DRAFT)
        self.url = f"/django-admin/surveys/survey/{self.survey.id}/change/"

    def test_console_made_super_admin_gets_is_staff_but_no_model_permission(self):
        u = User.objects.create_user("probe_sa@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        sync_django_staff_flag(u)
        u.refresh_from_db()
        self.assertTrue(u.is_staff)          # can sign in to /django-admin/
        self.assertFalse(u.is_superuser)
        self.assertFalse(u.has_perm("surveys.change_survey"))
        c = Client()
        c.force_login(u)
        r = c.get(self.url)
        # 403 or a redirect away == the window is NOT settable by this account.
        print("SUPER_ADMIN(no perms) change-form status:", r.status_code)
        index = c.get("/django-admin/")
        print("SUPER_ADMIN(no perms) admin index status:", index.status_code)
        print("surveys listed on index:", "surveys/survey/" in index.content.decode())

    def test_a_django_superuser_can(self):
        u = User.objects.create_user("probe_root@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        User.objects.filter(pk=u.pk).update(is_staff=True, is_superuser=True)
        u.refresh_from_db()
        c = Client()
        c.force_login(u)
        r = c.get(self.url)
        print("django superuser change-form status:", r.status_code)
        self.assertEqual(r.status_code, 200)

    def test_granting_the_one_model_permission_is_enough(self):
        from django.contrib.auth.models import Permission
        u = User.objects.create_user("probe_perm@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        sync_django_staff_flag(u)
        u.refresh_from_db()
        u.user_permissions.add(
            Permission.objects.get(content_type__app_label="surveys", codename="change_survey")
        )
        u = User.objects.get(pk=u.pk)
        c = Client()
        c.force_login(u)
        r = c.get(self.url)
        print("SUPER_ADMIN + change_survey perm status:", r.status_code)
