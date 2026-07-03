"""Service layer for the assessments app — orchestration extracted from the views.

Views stay thin (permission → serializer → service → Response); the services own
transactional workflows so that ordering/locking invariants live in one place.
"""
