"""The avatar catalog: twelve characters, each with a default look and three skins.

Defined in code, not in the database, because the art is code too — every character is
drawn by the frontend from its key (`features/liveQuiz/avatars.tsx`). A row an admin could
add would have no picture. The server owns what matters to fairness: which keys exist, what
they cost, and who owns what.

Keys are strings so they can sit in a ledger row and outlive any refactor:

    char:<character>            the character, in its default look
    skin:<character>:<tier>     one of its three skins

A skin belongs to one character and cannot be worn by another, which is why a skin is bought
only after its character.
"""

from __future__ import annotations

COMMON = "common"
RARE = "rare"
EPIC = "epic"

CHARACTER_PRICES = {COMMON: 100, RARE: 250, EPIC: 500}

SKIN_TIERS = ("rare", "epic", "legendary")
SKIN_PRICES = {"rare": 150, "epic": 300, "legendary": 600}
SKIN_NAMES = {"rare": "Sunset", "epic": "Galaxy", "legendary": "Golden"}

# (key, name, tier, starter). Starters are the three a new player may claim one of for free.
_ROSTER = (
    ("owl", "Hoot", COMMON, True),
    ("cat", "Mochi", COMMON, True),
    ("robot", "Bolt", COMMON, True),
    ("fox", "Ember", COMMON, False),
    ("panda", "Bao", COMMON, False),
    ("frog", "Lily", COMMON, False),
    ("penguin", "Pebble", RARE, False),
    ("dino", "Rex", RARE, False),
    ("bunny", "Clover", RARE, False),
    ("dragon", "Blaze", EPIC, False),
    ("unicorn", "Nova", EPIC, False),
    ("alien", "Zip", EPIC, False),
)

CHARACTERS: dict[str, dict] = {
    key: {"name": name, "tier": tier, "price": CHARACTER_PRICES[tier], "starter": starter}
    for key, name, tier, starter in _ROSTER
}

STARTERS = tuple(key for key, info in CHARACTERS.items() if info["starter"])


def character_key(character: str) -> str:
    return f"char:{character}"


def skin_key(character: str, tier: str) -> str:
    return f"skin:{character}:{tier}"


def parse(item_key: str):
    """``("character", key, None)``, ``("skin", key, tier)``, or None for anything else."""
    parts = str(item_key or "").split(":")
    if len(parts) == 2 and parts[0] == "char" and parts[1] in CHARACTERS:
        return ("character", parts[1], None)
    if len(parts) == 3 and parts[0] == "skin" and parts[1] in CHARACTERS and parts[2] in SKIN_TIERS:
        return ("skin", parts[1], parts[2])
    return None


def price_of(item_key: str) -> int | None:
    parsed = parse(item_key)
    if parsed is None:
        return None
    kind, character, tier = parsed
    return CHARACTERS[character]["price"] if kind == "character" else SKIN_PRICES[tier]


def all_items() -> list[dict]:
    """Every item in shop order: each character followed by its three skins."""
    rows = []
    for key, info in CHARACTERS.items():
        rows.append(
            {
                "key": character_key(key),
                "kind": "character",
                "character": key,
                "tier": info["tier"],
                "name": info["name"],
                "price": info["price"],
                "starter": info["starter"],
            }
        )
        for tier in SKIN_TIERS:
            rows.append(
                {
                    "key": skin_key(key, tier),
                    "kind": "skin",
                    "character": key,
                    "tier": tier,
                    "name": f"{SKIN_NAMES[tier]} {info['name']}",
                    "price": SKIN_PRICES[tier],
                    "starter": False,
                }
            )
    return rows
