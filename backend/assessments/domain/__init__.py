# assessments domain services
#
# Business logic for assessment authoring/delivery lives here — never scatter it
# across views, serializers, or model.save(). Content is a LIVE single source of
# truth: there is no immutable version snapshot. An attempt freezes only WHICH
# questions it covers (question_order); their content is read live from the
# AssessmentQuestion rows for grading, delivery and review.
#
# MODULES:
#   publish_validator.py    — approve/activate validation pipeline (live active questions)
#   homework_versioning.py  — attach an assessment set to a classroom as homework
#   bank_integration.py     — Question Bank → assessment link + live edit propagation
#   bank_sync.py            — mirror builder-authored questions into the Question Bank
#   governance_events.py    — append-only audit event dispatch
#
# USAGE:
#   from assessments.domain.publish_validator import validate_for_publish
#   from assessments.domain.governance_events import emit_governance_event
