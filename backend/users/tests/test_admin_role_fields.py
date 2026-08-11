"""Django admin must be able to see and set the role that actually decides access.

It could not. The admin exposed only ``system_role`` — the legacy FK the model itself
documents as "not used for authorization" — while ``User.role``, which every permission check
reads, appeared in no fieldset and in neither custom form. So a support teacher could not be
created here at all.

Two layers, each silent on its own: a field missing from ``Meta.fields`` is dropped even when
``fieldsets`` names it, and a field with no ``choices`` renders as free text even when it is
present. Both are asserted.
"""

from __future__ import annotations

from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.test import TestCase

from access import constants as acc_const
from users.admin import CustomUserAdmin, CustomUserChangeForm, CustomUserCreationForm

User = get_user_model()


class AdminExposesTheCanonicalRoleTests(TestCase):
    def setUp(self):
        self.admin = CustomUserAdmin(User, AdminSite())

    def _fieldset_fields(self, fieldsets) -> set[str]:
        out: set[str] = set()
        for _label, opts in fieldsets:
            for f in opts.get("fields", ()):
                out.update(f) if isinstance(f, (tuple, list)) else out.add(f)
        return out

    def test_role_and_subject_are_on_the_change_form(self):
        fields = self._fieldset_fields(self.admin.fieldsets)
        self.assertIn("role", fields)
        self.assertIn("subject", fields)

    def test_role_and_subject_are_on_the_add_form(self):
        fields = self._fieldset_fields(self.admin.add_fieldsets)
        self.assertIn("role", fields)
        self.assertIn("subject", fields)

    def test_the_forms_actually_render_them(self):
        # A ModelForm with an explicit Meta.fields drops anything missing from it, so naming a
        # field in `fieldsets` alone renders nothing. This is the half that was easy to miss.
        for form_cls in (CustomUserCreationForm, CustomUserChangeForm):
            with self.subTest(form=form_cls.__name__):
                self.assertIn("role", form_cls.Meta.fields)
                self.assertIn("subject", form_cls.Meta.fields)

    def test_role_offers_every_canonical_role_as_a_choice(self):
        # Without choices the admin renders a text box, so the only way to set a role was to
        # type it exactly — and a typo is a silently broken account, not an error.
        offered = {value for value, _label in User._meta.get_field("role").choices}
        self.assertEqual(offered, set(acc_const.CANONICAL_ROLES))

    def test_support_teacher_is_among_them(self):
        offered = {value for value, _label in User._meta.get_field("role").choices}
        self.assertIn(acc_const.ROLE_SUPPORT_TEACHER, offered)

    def test_the_choices_are_ordered_not_derived_from_a_set(self):
        # Generating them from the CANONICAL_ROLES frozenset would reorder between runs and
        # make makemigrations emit a fresh AlterField whenever the set rehashed.
        values = [value for value, _label in acc_const.ROLE_CHOICES]
        self.assertEqual(values, list(dict.fromkeys(values)))  # no duplicates
        self.assertEqual(values[0], acc_const.ROLE_STUDENT)    # a deliberate, stable order

    def test_a_support_teacher_can_be_created_with_a_subject(self):
        user = User.objects.create_user(
            "st_admin@t.com", "secret123",
            role=acc_const.ROLE_SUPPORT_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.assertEqual(user.role, acc_const.ROLE_SUPPORT_TEACHER)
        self.assertEqual(user.subject, acc_const.DOMAIN_MATH)

    def test_a_support_teacher_without_a_subject_is_still_refused(self):
        # The form now offers the field; the rule behind it is unchanged.
        with self.assertRaises(ValueError):
            User.objects.create_user(
                "st_nosubj@t.com", "secret123", role=acc_const.ROLE_SUPPORT_TEACHER
            )
