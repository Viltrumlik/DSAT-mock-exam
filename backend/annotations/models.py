"""Study annotations — the highlights and underlines a student paints on text.

These used to live only in `localStorage` ("purely a study annotation … never synced", the
old annotationStore docstring). That was fine while highlighting only had to survive a
re-render inside one sitting. It stopped being fine the moment the highlights had to appear
on the **review** page: review is a separate visit, often days later and often on a different
device, and the native iOS runner has no localStorage at all.

One table serves all three surfaces because the annotator is one implementation:

    scope=exam        ref=<TestAttempt id>       target_id=<Question id>
    scope=assessment  ref=<AssessmentAttempt id> target_id=<AssessmentQuestion id>
    scope=vocab       ref=<VocabularySet id>     target_id=<Word id>

``ref`` is a string, not an FK: the three scopes point at three unrelated tables with
unrelated lifecycles, and a hard FK would make deleting any of them cascade into a student's
study notes. It is also why there is no referential validation here — an annotation on a
question that later disappears is harmless, and the read path simply never asks for it.

``container`` is the region within the target, each with its own character-offset space:
a question's passage, its prompt and its answer choices annotate independently.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class StudyAnnotation(models.Model):
    SCOPE_EXAM = "exam"
    SCOPE_ASSESSMENT = "assessment"
    SCOPE_VOCAB = "vocab"
    SCOPE_CHOICES = [
        (SCOPE_EXAM, "Exam / pastpaper"),
        (SCOPE_ASSESSMENT, "Assessment"),
        (SCOPE_VOCAB, "Vocabulary"),
    ]

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="study_annotations"
    )
    scope = models.CharField(max_length=16, choices=SCOPE_CHOICES, db_index=True)
    ref = models.CharField(max_length=64, db_index=True)
    target_id = models.BigIntegerField()
    container = models.CharField(max_length=32)

    #: A list of ``{start, end, kind, color?, underline?}`` in the container's own offset
    #: space. Stored verbatim as the client computed it — the server has no opinion about
    #: what the text says, and re-deriving offsets here would need the rendered DOM.
    data = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        db_table = "study_annotations"
        ordering = ["target_id", "container"]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "scope", "ref", "target_id", "container"],
                name="uniq_annotation_per_region",
            ),
        ]
        indexes = [
            # The only read the product performs: "everything this student marked on this
            # attempt/set", answered in one query when the review page opens.
            models.Index(fields=["student", "scope", "ref"]),
        ]

    def __str__(self) -> str:
        return f"{self.scope}:{self.ref} q{self.target_id}/{self.container} ({len(self.data or [])})"
