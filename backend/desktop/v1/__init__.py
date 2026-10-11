"""The native Windows app's own API: ``/api/desktop/v1/``.

The wire contract is ``desktop-native/contracts/v1/`` — JSON fixtures the server's tests and
the app's tests both load. The design is ``native-rewrite/design-panel/design_data_server.md``
§2: the whole test downloads once, answers are kept on the laptop and sent at the module's end
(plus a quiet background copy), and every write answers with a small attempt summary
(``AttemptLite``) rather than the website's full snapshot.

Nothing here owns an exam rule. Every state change goes through the existing state machines
(``exams.TestAttempt``, ``midterms.MidtermAttempt``) and the midterm rules the website already
enforces (``midterms.views`` late-answer grace, ``desktop.lockdown``). What v1 adds is the shape:
one bundle per test, lite writes, and an idempotency layer that never replays a 5xx.

Everything is behind ``settings.DESKTOP_V1_ENABLED`` (default off → 503 desktop_v1_disabled).
"""
