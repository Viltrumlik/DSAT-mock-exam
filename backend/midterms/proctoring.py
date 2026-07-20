"""Off-screen proctoring rule for midterms.

A midterm is sat in fullscreen. Leaving it — switching windows, tabbing away, minimising —
is an offence. The rule, in one place because the browser must be TOLD it (it renders the
countdown) while never being allowed to DECIDE it:

    offence 1  ->  GRACE_SECONDS to return, else the paper is taken in
    offence 2  ->  GRACE_SECONDS to return, else the paper is taken in
    offence 3  ->  no grace at all; the paper is taken in immediately

Lives in its own module rather than in ``views`` so ``serializers`` can publish the numbers
to the runner without importing the view layer (which imports serializers).
"""

from __future__ import annotations

# Seconds a student has to return to the exam window before their paper is taken in.
GRACE_SECONDS = 3

# Offences allowed before the sitting is forfeited outright. The Nth offence terminates.
VIOLATION_LIMIT = 3
