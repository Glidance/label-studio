"""Tests for annotation review / approval feature."""

from django.test import override_settings
from organizations.tests.factories import OrganizationFactory
from projects.tests.factories import ProjectFactory
from rest_framework.test import APITestCase
from tasks.tests.factories import AnnotationFactory, TaskFactory
from users.tests.factories import UserFactory

REVIEWER_EMAIL = 'reviewer@example.com'
LABELER_EMAIL = 'labeler@example.com'

REVIEW_SETTINGS = {
    'REVIEW_ENABLED': True,
    'REVIEW_APPROVERS': {REVIEWER_EMAIL},
}


class ReviewHelperTests(APITestCase):
    """Tests for can_review() and is_review_enabled() helpers."""

    def test_parse_approvers_env(self):
        from tasks.review import can_review, is_review_enabled

        with override_settings(REVIEW_ENABLED=True, REVIEW_APPROVERS={'a@b.com', 'c@d.com'}):
            self.assertTrue(is_review_enabled())
            user = UserFactory(email='a@b.com')
            self.assertTrue(can_review(user))

    def test_disabled_feature(self):
        from tasks.review import can_review, is_review_enabled

        with override_settings(REVIEW_ENABLED=False, REVIEW_APPROVERS={REVIEWER_EMAIL}):
            self.assertFalse(is_review_enabled())
            user = UserFactory(email=REVIEWER_EMAIL)
            self.assertFalse(can_review(user))

    def test_non_reviewer_cannot_review(self):
        from tasks.review import can_review

        with override_settings(REVIEW_ENABLED=True, REVIEW_APPROVERS={REVIEWER_EMAIL}):
            user = UserFactory(email=LABELER_EMAIL)
            self.assertFalse(can_review(user))

    def test_case_insensitive_email(self):
        from tasks.review import can_review

        with override_settings(REVIEW_ENABLED=True, REVIEW_APPROVERS={'reviewer@example.com'}):
            user = UserFactory(email='Reviewer@Example.COM')
            self.assertTrue(can_review(user))


@override_settings(**REVIEW_SETTINGS)
class ApproveRejectAPITests(APITestCase):
    """Tests for the /api/annotations/<id>/approve and /reject endpoints."""

    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.reviewer = UserFactory(email=REVIEWER_EMAIL, active_organization=cls.organization)
        cls.labeler = UserFactory(email=LABELER_EMAIL, active_organization=cls.organization)
        cls.task = TaskFactory(project=cls.project, data={'text': 'hello'})
        cls.annotation = AnnotationFactory(
            task=cls.task,
            completed_by=cls.labeler,
            result=[{'value': {'choices': ['pos']}, 'from_name': 'sent', 'to_name': 'text', 'type': 'choices'}],
        )

    def test_reviewer_can_approve(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.post(f'/api/annotations/{self.annotation.id}/approve')
        self.assertEqual(resp.status_code, 200)
        self.annotation.refresh_from_db()
        self.assertEqual(self.annotation.last_action, 'accepted')
        self.assertEqual(self.annotation.last_created_by_id, self.reviewer.id)

    def test_reviewer_can_reject(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.post(f'/api/annotations/{self.annotation.id}/reject')
        self.assertEqual(resp.status_code, 200)
        self.annotation.refresh_from_db()
        self.assertEqual(self.annotation.last_action, 'rejected')
        self.assertEqual(self.annotation.last_created_by_id, self.reviewer.id)

    def test_labeler_cannot_approve(self):
        self.client.force_authenticate(user=self.labeler)
        resp = self.client.post(f'/api/annotations/{self.annotation.id}/approve')
        self.assertEqual(resp.status_code, 403)

    def test_labeler_cannot_reject(self):
        self.client.force_authenticate(user=self.labeler)
        resp = self.client.post(f'/api/annotations/{self.annotation.id}/reject')
        self.assertEqual(resp.status_code, 403)

    def test_unauthenticated_cannot_approve(self):
        resp = self.client.post(f'/api/annotations/{self.annotation.id}/approve')
        self.assertIn(resp.status_code, [401, 403])


@override_settings(REVIEW_ENABLED=False, REVIEW_APPROVERS={REVIEWER_EMAIL})
class ReviewDisabledTests(APITestCase):
    """Tests that review endpoints return 403 when feature is disabled."""

    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.reviewer = UserFactory(email=REVIEWER_EMAIL, active_organization=cls.organization)
        cls.task = TaskFactory(project=cls.project, data={'text': 'hello'})
        cls.annotation = AnnotationFactory(
            task=cls.task,
            completed_by=cls.reviewer,
            result=[{'value': {'choices': ['pos']}, 'from_name': 'sent', 'to_name': 'text', 'type': 'choices'}],
        )

    def test_approve_blocked_when_disabled(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.post(f'/api/annotations/{self.annotation.id}/approve')
        self.assertEqual(resp.status_code, 403)


@override_settings(**REVIEW_SETTINGS)
class TamperingProtectionTests(APITestCase):
    """Tests that non-reviewers cannot set review fields via PATCH."""

    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.reviewer = UserFactory(email=REVIEWER_EMAIL, active_organization=cls.organization)
        cls.labeler = UserFactory(email=LABELER_EMAIL, active_organization=cls.organization)
        cls.task = TaskFactory(project=cls.project, data={'text': 'hello'})
        cls.annotation = AnnotationFactory(
            task=cls.task,
            completed_by=cls.labeler,
            result=[{'value': {'choices': ['pos']}, 'from_name': 'sent', 'to_name': 'text', 'type': 'choices'}],
        )

    def test_labeler_cannot_set_last_action(self):
        self.client.force_authenticate(user=self.labeler)
        resp = self.client.patch(
            f'/api/annotations/{self.annotation.id}/',
            data={'last_action': 'accepted'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_reviewer_normal_update_works(self):
        self.client.force_authenticate(user=self.reviewer)
        new_result = [{'value': {'choices': ['neg']}, 'from_name': 'sent', 'to_name': 'text', 'type': 'choices'}]
        resp = self.client.patch(
            f'/api/annotations/{self.annotation.id}/',
            data={'result': new_result},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)


@override_settings(**REVIEW_SETTINGS)
class ResetOnEditTests(APITestCase):
    """Tests that editing an annotation resets its approval status."""

    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.organization)
        cls.reviewer = UserFactory(email=REVIEWER_EMAIL, active_organization=cls.organization)
        cls.labeler = UserFactory(email=LABELER_EMAIL, active_organization=cls.organization)
        cls.task = TaskFactory(project=cls.project, data={'text': 'hello'})

    def test_edit_resets_approval(self):
        annotation = AnnotationFactory(
            task=self.task,
            completed_by=self.labeler,
            result=[{'value': {'choices': ['pos']}, 'from_name': 'sent', 'to_name': 'text', 'type': 'choices'}],
        )

        # Reviewer approves
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.post(f'/api/annotations/{annotation.id}/approve')
        self.assertEqual(resp.status_code, 200)
        annotation.refresh_from_db()
        self.assertEqual(annotation.last_action, 'accepted')

        # Labeler edits the annotation result
        self.client.force_authenticate(user=self.labeler)
        new_result = [{'value': {'choices': ['neg']}, 'from_name': 'sent', 'to_name': 'text', 'type': 'choices'}]
        resp = self.client.patch(
            f'/api/annotations/{annotation.id}/',
            data={'result': new_result},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)

        # Approval should be reset
        annotation.refresh_from_db()
        self.assertIsNone(annotation.last_action)
        self.assertIsNone(annotation.last_created_by_id)

    def test_no_reset_when_result_unchanged(self):
        original_result = [{'value': {'choices': ['pos']}, 'from_name': 'sent', 'to_name': 'text', 'type': 'choices'}]
        annotation = AnnotationFactory(
            task=self.task,
            completed_by=self.labeler,
            result=original_result,
        )

        # Reviewer approves
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.post(f'/api/annotations/{annotation.id}/approve')
        self.assertEqual(resp.status_code, 200)

        # Labeler sends update with same result (no actual change)
        self.client.force_authenticate(user=self.labeler)
        resp = self.client.patch(
            f'/api/annotations/{annotation.id}/',
            data={'result': original_result},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)

        # Approval should still be present
        annotation.refresh_from_db()
        self.assertEqual(annotation.last_action, 'accepted')


@override_settings(**REVIEW_SETTINGS)
class WhoAmIReviewTests(APITestCase):
    """Tests that the WhoAmI endpoint includes review capabilities."""

    @classmethod
    def setUpTestData(cls):
        cls.organization = OrganizationFactory()
        cls.reviewer = UserFactory(email=REVIEWER_EMAIL, active_organization=cls.organization)
        cls.labeler = UserFactory(email=LABELER_EMAIL, active_organization=cls.organization)

    def test_reviewer_sees_can_review(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.get('/api/current-user/whoami')
        self.assertEqual(resp.status_code, 200)
        review = resp.json().get('review', {})
        self.assertTrue(review['enabled'])
        self.assertTrue(review['can_review'])

    def test_labeler_sees_cannot_review(self):
        self.client.force_authenticate(user=self.labeler)
        resp = self.client.get('/api/current-user/whoami')
        self.assertEqual(resp.status_code, 200)
        review = resp.json().get('review', {})
        self.assertTrue(review['enabled'])
        self.assertFalse(review['can_review'])
