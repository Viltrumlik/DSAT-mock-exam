"""Turning vocabulary words into quiz questions.

A vocabulary set stores words, not questions, so a live quiz has to make its own. It makes
them **once**, when the room is created, and stores them — which is what lets the same game
be replayed, reviewed and argued about afterwards. Two students looking at question four
are looking at the same four options in the same order.

The distractor rules here are a port of ``features/vocabulary/modes/utils.ts``
``pickDistractors``, and they are the part worth reading twice:

* a word spelled the same as the answer is never an option, and
* a word **meaning** the same as the answer is never an option either.

The second is the subtle one. Every form of this question asks the student to pair a word
with a meaning, so a candidate that shares the answer's definition is not a wrong answer —
it is a second right one, and the student who picks it is marked wrong for being correct.
"""

from __future__ import annotations

import random
import unicodedata

OPTION_IDS = ("A", "B", "C", "D")
OPTION_COUNT = len(OPTION_IDS)

# The two shapes a question can take. Sessions mix them, so a student cannot settle into
# answering on shape alone and has to actually read.
FORM_DEFINITION_TO_WORD = "definition_to_word"
FORM_WORD_TO_DEFINITION = "word_to_definition"
FORMS = (FORM_DEFINITION_TO_WORD, FORM_WORD_TO_DEFINITION)

ASK_FOR_WORD = "Which word means this?"
ASK_FOR_DEFINITION = "What does this word mean?"

# Four options need the answer plus three others that are neither spelled nor meant alike.
MIN_WORDS = OPTION_COUNT


def normalize(text: object) -> str:
    """Fold case, whitespace and full-width characters, as the study modes do."""
    try:
        folded = unicodedata.normalize("NFKC", str(text or ""))
    except (TypeError, ValueError):
        folded = str(text or "")
    return " ".join(folded.strip().lower().split())


def pick_distractors(pool, target, count: int, rng=None) -> list:
    """Up to ``count`` words from ``pool`` that are safe wrong answers for ``target``."""
    if count <= 0:
        return []
    rng = rng or random

    seen_words = {normalize(target.word)}
    target_definition = normalize(target.definition)

    candidates = []
    for candidate in pool:
        if candidate.pk == target.pk:
            continue
        key = normalize(candidate.word)
        if key in seen_words:
            continue
        # Checked before `key` is reserved, so a twin dropped here does not block a
        # genuinely different word that happens to share its spelling.
        if normalize(candidate.definition) == target_definition:
            continue
        seen_words.add(key)
        candidates.append(candidate)

    rng.shuffle(candidates)
    return candidates[:count]


def build_question(*, word, pool, rng=None, form: str | None = None) -> dict | None:
    """One question for ``word``, or None when the set cannot furnish enough options.

    Returns the plain fields a ``LiveQuizQuestion`` is built from, so the caller does the
    storing and this stays testable without a database.
    """
    rng = rng or random
    form = form or rng.choice(FORMS)

    distractors = pick_distractors(pool, word, OPTION_COUNT - 1, rng=rng)
    if len(distractors) < OPTION_COUNT - 1:
        # Too few genuinely different words — better no question than one with two right
        # answers or a blank option.
        return None

    if form == FORM_WORD_TO_DEFINITION:
        stem, ask = word.word, ASK_FOR_DEFINITION
        texts = [word.definition] + [d.definition for d in distractors]
    else:
        stem, ask = word.definition, ASK_FOR_WORD
        texts = [word.word] + [d.word for d in distractors]

    # The answer starts at index 0; shuffle the pairs so it does not always land on A.
    options = list(zip(texts, [True] + [False] * len(distractors)))
    rng.shuffle(options)

    choices, correct = [], None
    for option_id, (text, is_answer) in zip(OPTION_IDS, options):
        choices.append({"id": option_id, "text": str(text)})
        if is_answer:
            correct = option_id

    return {
        "prompt": str(stem),
        "question_prompt": ask,
        "question_type": "multiple_choice",
        "choices": choices,
        "correct_answer": correct,
        # The example sentence is the most useful thing to show once the answer is out.
        "explanation": str(getattr(word, "example", "") or ""),
        "form": form,
    }
