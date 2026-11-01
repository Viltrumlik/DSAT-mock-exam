"""Live Quiz vocabulary: states, events, config defaults and limits.

Everything the game agrees on lives here so a view, a consumer and a test all read the same
words. Compare against these constants, never against a bare string — status casing differs
per app in this codebase and a copied literal is how that bites.
"""

from __future__ import annotations

# ─── Session states ───────────────────────────────────────────────────────────
#
#   LOBBY ─► STARTING ─► QUESTION_ACTIVE ⇄ QUESTION_RESULTS ─► … ─► FINISHED
#                              │                  │
#                              └──── PAUSED ──────┘        (any live state ─► TERMINATED)
#
# There is deliberately no NEXT_QUESTION state: advancing is the act of opening the next
# question, and a state between the two would be indistinguishable from QUESTION_ACTIVE.
# STARTING does earn its place — it is the countdown screen before question one.

STATUS_LOBBY = "LOBBY"
STATUS_STARTING = "STARTING"
STATUS_QUESTION_ACTIVE = "QUESTION_ACTIVE"
STATUS_QUESTION_RESULTS = "QUESTION_RESULTS"
STATUS_PAUSED = "PAUSED"
STATUS_FINISHED = "FINISHED"
STATUS_TERMINATED = "TERMINATED"

STATUS_CHOICES = [
    (STATUS_LOBBY, "Lobby"),
    (STATUS_STARTING, "Starting"),
    (STATUS_QUESTION_ACTIVE, "Question active"),
    (STATUS_QUESTION_RESULTS, "Question results"),
    (STATUS_PAUSED, "Paused"),
    (STATUS_FINISHED, "Finished"),
    (STATUS_TERMINATED, "Terminated"),
]

# Statuses in which a session still holds its join code. A finished session releases the
# code so it can be minted again tomorrow — see the partial unique constraint on the model.
LIVE_STATUSES = (
    STATUS_LOBBY,
    STATUS_STARTING,
    STATUS_QUESTION_ACTIVE,
    STATUS_QUESTION_RESULTS,
    STATUS_PAUSED,
)
TERMINAL_STATUSES = (STATUS_FINISHED, STATUS_TERMINATED)


# ─── Participant states ───────────────────────────────────────────────────────

PARTICIPANT_JOINED = "JOINED"
PARTICIPANT_LEFT = "LEFT"
PARTICIPANT_KICKED = "KICKED"

PARTICIPANT_STATUS_CHOICES = [
    (PARTICIPANT_JOINED, "Joined"),
    (PARTICIPANT_LEFT, "Left"),
    (PARTICIPANT_KICKED, "Removed by host"),
]


# ─── Events, server → client ──────────────────────────────────────────────────

EV_SESSION_STATE = "session_state"          # full snapshot; sent on every (re)connect
EV_PARTICIPANT_JOINED = "participant_joined"
EV_PARTICIPANT_LEFT = "participant_left"
EV_LOBBY_UPDATED = "lobby_updated"
EV_GAME_STARTED = "game_started"
EV_QUESTION_STARTED = "question_started"
EV_QUESTION_TIME_WARNING = "question_time_warning"
EV_QUESTION_ENDED = "question_ended"
EV_ANSWER_RESULT = "answer_result"          # to the one who answered
EV_ANSWER_TALLY = "answer_tally"            # to the host: how many are in, without names
EV_LEADERBOARD_UPDATED = "leaderboard_updated"
EV_GAME_PAUSED = "game_paused"
EV_GAME_RESUMED = "game_resumed"
EV_GAME_FINISHED = "game_finished"
EV_SESSION_TERMINATED = "session_terminated"
EV_REMOVED = "removed_from_session"  # to the one taken out of the room
EV_ERROR = "error"
EV_PONG = "pong"
# Student-paced. `question_started` and `answer_result` are reused, sent to one student's own
# sockets rather than the room — which is what keeps an app that predates the mode playable.
EV_PLAYER_PROGRESS = "player_progress"      # to the host: one student just moved on
EV_POWERUP_AWARDED = "powerup_awarded"      # to the student who earned it
EV_POWERUP_APPLIED = "powerup_applied"      # to the student who used it


# ─── Commands, client → server ────────────────────────────────────────────────

CMD_START_GAME = "start_game"
CMD_START_QUESTION = "start_question"
CMD_SUBMIT_ANSWER = "submit_answer"
CMD_REQUEST_NEXT_QUESTION = "request_next_question"
CMD_END_QUESTION = "end_question"
CMD_PAUSE_GAME = "pause_game"
CMD_RESUME_GAME = "resume_game"
CMD_END_GAME = "end_game"
CMD_REMOVE_PARTICIPANT = "remove_participant"
CMD_LEAVE_SESSION = "leave_session"
CMD_HEARTBEAT = "heartbeat"
CMD_USE_POWERUP = "use_powerup"

# Commands that only make sense when the host drives the clock. In a student-paced game every
# student has their own question, so "skip to the answer" has nothing to act on.
INSTRUCTOR_PACED_COMMANDS = frozenset(
    {CMD_START_QUESTION, CMD_REQUEST_NEXT_QUESTION, CMD_END_QUESTION}
)

# Commands only the host may send. A student sending one gets an error frame and is
# otherwise ignored — the check is here, server-side, not in the UI that hides the button.
HOST_ONLY_COMMANDS = frozenset(
    {
        CMD_START_GAME,
        CMD_START_QUESTION,
        CMD_REQUEST_NEXT_QUESTION,
        CMD_END_QUESTION,
        CMD_PAUSE_GAME,
        CMD_RESUME_GAME,
        CMD_END_GAME,
        CMD_REMOVE_PARTICIPANT,
    }
)


# ─── Error codes on the wire ──────────────────────────────────────────────────

ERR_INVALID_COMMAND = "invalid_command"
ERR_NOT_HOST = "not_host"
ERR_BAD_STATE = "bad_state"
ERR_TOO_LATE = "too_late"
ERR_ALREADY_ANSWERED = "already_answered"
ERR_NOT_PARTICIPANT = "not_participant"
ERR_UNKNOWN_QUESTION = "unknown_question"
ERR_ACCOUNT_FROZEN = "account_frozen"
ERR_NO_POWERUP = "no_powerup"
ERR_WRONG_MODE = "wrong_mode"


# ─── Join codes ───────────────────────────────────────────────────────────────

# No O/0 or I/1: the code is read aloud off a projector and typed by a teenager in a hurry.
JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
JOIN_CODE_LENGTH = 6


# ─── Configuration ────────────────────────────────────────────────────────────

# The host sets these when creating the game; everything absent falls back to these values.
# Stored on the session so a config change tomorrow cannot rewrite how yesterday was scored.
CONFIG_DEFAULTS: dict = {
    "question_seconds": 20,
    # Fraction of the base score awarded on top for answering instantly, decaying linearly to
    # zero at the deadline. 0 turns the game into flat marking.
    "speed_bonus_ratio": 0.5,
    "allow_answer_change": False,
    "show_leaderboard_between": True,
    # Whether a student is told right away if they were right. Off turns the round into a
    # silent quiz where only the final board reveals anything.
    "reveal_correctness": True,
    "shuffle_questions": False,
    # The host advances by hand rather than the server rolling straight into the next
    # question. A classroom wants the pause for discussion; leave it on.
    "manual_advance": True,
    # Who drives the clock — see MODES below. The fallback is teacher-paced because that is
    # what every room created before modes existed IS: its config has no "mode" key, and it
    # must keep playing the way it was created. New rooms get NEW_SESSION_DEFAULTS instead.
    "mode": "instructor_paced",
    # Student-paced extras. Each student sees the choices in their own order; after each
    # answer they are shown the right one; streaks earn power-ups.
    "shuffle_answers": False,
    "show_answers": True,
    "powerups": False,
    # What one question point is worth on the board. 100 for every room created before the
    # rebuild; new rooms use the classroom-game scale below. Internal: not offered to the host.
    "point_scale": 100,
}

CONFIG_KEYS = frozenset(CONFIG_DEFAULTS)

# ─── Modes ────────────────────────────────────────────────────────────────────
#
# Student-paced is the classic classroom game: everyone starts together, then each student
# answers at their own speed, sees right away how they did, and moves on. The session sits in
# QUESTION_ACTIVE for the whole round — "in play" — and each student's own question and
# deadline live on their participant row. Reusing that status rather than inventing one is
# deliberate: an app built before this mode reads it as "a question is open", takes the
# per-student `question_started` frames as they come, and stays playable.
#
# Teacher-paced is the original engine: one question for the whole room, the host moves on.
MODE_STUDENT_PACED = "student_paced"
MODE_INSTRUCTOR_PACED = "instructor_paced"
MODES = (MODE_STUDENT_PACED, MODE_INSTRUCTOR_PACED)

# What a room created today starts from when the host leaves something out.
#
# The score scale is the familiar classroom-game one: a right answer is worth 600, plus up to
# 400 more for answering at once (a speed bonus of 400/600 of the base, decaying to nothing at
# the deadline), so every right answer lands between 600 and 1000. No clock, no bonus: 600.
NEW_SESSION_DEFAULTS: dict = {
    **CONFIG_DEFAULTS,
    "question_seconds": 30,
    "mode": MODE_STUDENT_PACED,
    "shuffle_questions": True,
    "shuffle_answers": True,
    "powerups": True,
    "point_scale": 600,
    "speed_bonus_ratio": round(400 / 600, 4),
}

# Bounds, enforced when a session is created. A 2-second question is not a quiz and a
# 10-minute one is homework.
MIN_QUESTION_SECONDS = 5
MAX_QUESTION_SECONDS = 300

# Student-paced only: 0 seconds means no clock at all — a test, not a race. There is no
# speed bonus without a clock, so a room with no timer scores accuracy and streaks alone.
NO_TIMER = 0

# Student-paced: how long the "correct / incorrect" screen stays up before the next question
# opens. The next question's clock starts when it appears, not when the last one was
# answered, so reading the feedback never costs anybody time.
FEEDBACK_SECONDS = 3

# Answers that arrive within this many milliseconds after the deadline still count. The
# deadline is the server's, so a student who tapped at 19.9s can easily arrive at 20.2s;
# refusing that is punishing them for their wifi.
LATE_ANSWER_GRACE_MS = 750

# Seconds of countdown between "Start" and question one.
COUNTDOWN_SECONDS = 3

# Seconds before the deadline that the time-warning frame goes out.
TIME_WARNING_SECONDS = 5

# One room. Large enough for any class this school runs, small enough that a leaked code
# cannot turn into a stampede.
MAX_PARTICIPANTS = 60

# Score scale: a 1-point question is worth 100 before the speed bonus, so the board reads
# like a game rather than like a mark out of 8.
BASE_POINT_SCALE = 100
