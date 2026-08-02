"""Off-screen proctoring rule for full mocks.

A proctored mock is sat in fullscreen. Leaving it — switching windows, tabbing away,
minimising — is an offence. The rule, in one place because the browser must be TOLD it
(it renders the countdown) while never being allowed to DECIDE it:

    offence 1  ->  GRACE_SECONDS to return, else the paper is taken in
    offence 2  ->  GRACE_SECONDS to return, else the paper is taken in
    offence 3  ->  no grace at all; the paper is taken in immediately

Deliberately its own module rather than importing ``midterms.proctoring``: the two exams
are run by different people for different reasons, and a mock sitting that wants a longer
leash than a midterm must be able to get one without editing the midterm's rule. The
numbers happen to match today.

Lives outside ``views`` so ``serializers`` can publish the numbers to the runner without
importing the view layer (which imports serializers).
"""

from __future__ import annotations

# Seconds a student has to return to the exam window before their paper is taken in.
GRACE_SECONDS = 3

# Offences allowed before the sitting is forfeited outright. The Nth offence terminates.
VIOLATION_LIMIT = 3

# ``MockAttempt.terminated_reason`` when the off-screen rule ended the sitting.
TERMINATION_OFFSCREEN = "OFFSCREEN"
