"""Midterm certificate issuance.

Two paths (fully wired in the schedule/certificate re-home step):
  * STANDALONE — auto-issued on submit; instructor = the teacher who granted access; NO rank.
  * CLASSROOM  — issued by the teacher after all students finish; class-ranked; publish-gated.

Until the classes-app certificate table gains its ``midterm``/``midterm_attempt`` FKs, these
helpers no-op cleanly so the attempt lifecycle works without a certificate backend.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _certificate_model_ready():
    """Return the MidtermCertificate model iff it has been re-homed onto midterms (has ``midterm`` FK)."""
    try:
        from classes.models_certificates import MidtermCertificate

        fields = {f.name for f in MidtermCertificate._meta.get_fields()}
        if "midterm" in fields and "flavor" in fields:
            return MidtermCertificate
    except Exception:  # pragma: no cover
        pass
    return None


def maybe_issue_standalone_certificate(attempt_id: int) -> None:
    """Auto-issue a STANDALONE certificate for a completed midterm attempt (no-op until re-home)."""
    Cert = _certificate_model_ready()
    if Cert is None:
        return
    # Full implementation ships with the schedule/certificate re-home (issue_standalone_certificate).
    from .certificate_service import issue_standalone_certificate

    issue_standalone_certificate(attempt_id)
