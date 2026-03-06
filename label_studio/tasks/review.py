"""Annotation review/approval helpers."""

from django.conf import settings


def is_review_enabled():
    """Return True if the annotation review feature is enabled."""
    return getattr(settings, 'REVIEW_ENABLED', False)


def can_review(user):
    """Return True if the given user is allowed to approve/reject annotations."""
    if not is_review_enabled():
        return False
    if user is None or not user.is_authenticated:
        return False
    approvers = getattr(settings, 'REVIEW_APPROVERS', set())
    return user.email.lower() in approvers
