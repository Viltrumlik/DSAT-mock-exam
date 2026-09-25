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

"Meaning the same" is caught three ways, cheapest first:

1. **The same definition text.** The obvious duplicate.
2. **The curated ``synonyms`` list**, in either direction, or a synonym the two share. This
   is the school's own judgement and it is the one to trust.
3. **Heavily overlapping definitions** — "sparing with money" against "sparing with money
   or food". Content words are compared after stopwords are dropped.

What none of this catches is a true paraphrase with no shared words: "truthful and
straightforward" against "honest and direct". Only a thesaurus or a language model would
see that, and neither belongs in the path that opens a classroom game. The curated synonym
list is the answer for those — fill it in and net 2 catches them exactly.
"""

from __future__ import annotations

import random
import re
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

# Two definitions counted as the same meaning when this much of their content vocabulary is
# shared (Jaccard). 0.6 catches "sparing with money" against "sparing with money or food"
# while leaving genuinely different definitions that happen to share a word or two alone.
DEFINITION_OVERLAP = 0.6

# Dropped before definitions are compared: they carry no meaning of their own and would
# make every short definition look like every other one.
STOPWORDS = frozenset(
    """
    a an the and or but nor of to in on at by for with from as into onto over under
    is are was were be being been am do does did have has had can could will would
    shall should may might must that this these those it its their his her our your
    not no nor very quite rather more most less least such so than then when where
    while who whom whose which what someone something somebody anyone anything one
    """.split()
)


def normalize(text: object) -> str:
    """Fold case, whitespace and full-width characters, as the study modes do."""
    try:
        folded = unicodedata.normalize("NFKC", str(text or ""))
    except (TypeError, ValueError):
        folded = str(text or "")
    return " ".join(folded.strip().lower().split())


def content_words(text: object) -> set[str]:
    """The words of a definition that carry its meaning."""
    found = re.findall(r"[a-z']+", normalize(text))
    return {w for w in found if len(w) > 2 and w not in STOPWORDS}


def definitions_overlap(first: object, second: object, threshold: float = DEFINITION_OVERLAP) -> bool:
    """Whether two definitions say the same thing in nearly the same words."""
    left, right = content_words(first), content_words(second)
    # A definition that boils down to a single content word carries too little to compare:
    # "to lessen" and "to worsen" would both be {lessen} / {worsen} and any shared word at
    # all would read as a perfect match. Those fall to the exact and synonym nets instead.
    if len(left) < 2 or len(right) < 2:
        return False
    return len(left & right) / len(left | right) >= threshold


def _synonyms_of(word) -> set[str]:
    return {normalize(s) for s in (getattr(word, "synonyms", None) or []) if normalize(s)}


def are_synonyms(first, second) -> bool:
    """Whether the bank itself says these two words mean the same.

    Either listing the other, or both listing a third word, is the school's own judgement
    and outranks anything guessed from the text.
    """
    first_syn, second_syn = _synonyms_of(first), _synonyms_of(second)
    if normalize(second.word) in first_syn or normalize(first.word) in second_syn:
        return True
    return bool(first_syn & second_syn)


def means_the_same(first, second) -> bool:
    """Every test for "this candidate is really a second correct answer"."""
    if normalize(first.definition) == normalize(second.definition):
        return True
    if are_synonyms(first, second):
        return True
    return definitions_overlap(first.definition, second.definition)


def pick_distractors(pool, target, count: int, rng=None) -> list:
    """Up to ``count`` words from ``pool`` that are safe wrong answers for ``target``."""
    if count <= 0:
        return []
    rng = rng or random

    seen_words = {normalize(target.word)}

    candidates = []
    for candidate in pool:
        if candidate.pk == target.pk:
            continue
        key = normalize(candidate.word)
        if key in seen_words:
            continue
        # Checked before `key` is reserved, so a twin dropped here does not block a
        # genuinely different word that happens to share its spelling.
        if means_the_same(target, candidate):
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
