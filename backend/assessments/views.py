"""
Aggregator for the assessments view layer.

The implementations live in focused modules — mirroring the ``classes.views_*``
pattern — so that no single file carries the whole surface:

  * ``helpers``            — small shared helpers (audit, image URLs, serialisers)
  * ``views_authoring``    — set/question authoring, publish, versions, QB picker
  * ``views_assign``       — teacher homework assignment
  * ``views_attempt``      — student attempt flow (start/bundle/answer/submit/abandon)
  * ``views_review``       — pedagogical review, teacher feedback, submission queue
  * ``views_grading_ops``  — admin grading metrics/controls, governance, ops
  * ``views_results``      — student result by assignment

This module re-exports their public surface so ``assessments.urls`` and any
other importer can keep doing ``from .views import ...`` unchanged.
"""

from .helpers import (
    _audit_attempt,
    _img_url,
    _image_map_for,
    _serialize_feedback,
    _build_hw_meta,
    _summarise_governance_payload,
    _QUESTION_IMAGE_FIELDS,
)
from .views_authoring import (
    AdminAssessmentSetListCreateView,
    AdminAssessmentSetDetailView,
    AdminAssessmentQuestionCreateView,
    AdminAssessmentQuestionDetailView,
    AdminAssessmentSetReorderView,
    AdminQuestionBankSelectView,
    AdminAssessmentQuestionFromBankView,
    AdminAssessmentSetCsvImportView,
    AdminAssessmentSetQuestionsCsvImportView,
    AdminQuestionBankTaxonomyView,
    AdminPublishAssessmentSetView,
    AdminValidatePublishView,
    AdminAssessmentSetStatusView,
    AdminAssessmentSetVersionListView,
    _sync_question_to_bank,
    _bank_sync_logger,
)
from .views_assign import AssignAssessmentHomeworkView
from .views_attempt import (
    StartAttemptView,
    AttemptBundleView,
    SaveAnswerView,
    SubmitAttemptView,
    AbandonAttemptView,
    PauseAttemptView,
    ResumeAttemptView,
)
from .views_review import (
    AttemptPedagogicalReviewView,
    AttemptTeacherFeedbackView,
    TeacherSubmissionQueueView,
)
from .views_grading_ops import (
    AdminGradingMetricsView,
    AdminAttemptStatusView,
    AdminRequeueAttemptView,
    AdminForceGradeAttemptView,
    AdminGradingPrometheusMetricsView,
    AdminHomeworkPrometheusMetricsView,
    AdminBuilderTelemetryView,
    AdminGovernanceEventListView,
    AdminFailedAttemptsListView,
)
from .views_results import MyAssessmentResultForAssignmentView, MyAssessmentResultForHomeworkView

__all__ = [
    # Authoring
    "AdminAssessmentSetListCreateView",
    "AdminAssessmentSetDetailView",
    "AdminAssessmentQuestionCreateView",
    "AdminAssessmentQuestionDetailView",
    "AdminAssessmentSetReorderView",
    "AdminQuestionBankSelectView",
    "AdminAssessmentQuestionFromBankView",
    "AdminAssessmentSetCsvImportView",
    "AdminAssessmentSetQuestionsCsvImportView",
    "AdminQuestionBankTaxonomyView",
    "AdminPublishAssessmentSetView",
    "AdminValidatePublishView",
    "AdminAssessmentSetStatusView",
    "AdminAssessmentSetVersionListView",
    # Assign
    "AssignAssessmentHomeworkView",
    # Attempt flow
    "StartAttemptView",
    "AttemptBundleView",
    "SaveAnswerView",
    "SubmitAttemptView",
    "AbandonAttemptView",
    "PauseAttemptView",
    "ResumeAttemptView",
    # Review
    "AttemptPedagogicalReviewView",
    "AttemptTeacherFeedbackView",
    "TeacherSubmissionQueueView",
    # Grading / ops
    "AdminGradingMetricsView",
    "AdminAttemptStatusView",
    "AdminRequeueAttemptView",
    "AdminForceGradeAttemptView",
    "AdminGradingPrometheusMetricsView",
    "AdminHomeworkPrometheusMetricsView",
    "AdminBuilderTelemetryView",
    "AdminGovernanceEventListView",
    "AdminFailedAttemptsListView",
    # Results
    "MyAssessmentResultForAssignmentView",
    "MyAssessmentResultForHomeworkView",
    # Helpers (kept on the aggregator for backwards-compatible imports/patches)
    "_audit_attempt",
    "_img_url",
    "_image_map_for",
    "_serialize_feedback",
    "_build_hw_meta",
    "_summarise_governance_payload",
    "_QUESTION_IMAGE_FIELDS",
    "_sync_question_to_bank",
    "_bank_sync_logger",
]
