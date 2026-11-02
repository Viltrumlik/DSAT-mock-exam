"""The avatar catalog: twelve characters, each with a default look and three skins.

Defined in code, not in the database, because the art is code too — every character is
drawn by the frontend from its key (`features/liveQuiz/avatars.tsx`). A row an admin could
add would have no picture. The server owns what matters to fairness: which keys exist, what
they cost, and who owns what.

Keys are strings so they can sit in a ledger row and outlive any refactor:

    char:<character>            the character, in its default look
    skin:<character>:<tier>     one of its three skins
    hat:<key>                   a hat, for any character
    frame:<key>                 a ring around the avatar's disc
    emote:<key>                 a speech bubble on the podium and the reveal

A skin belongs to one character and cannot be worn by another, which is why a skin is bought
only after its character. Hats, frames and emotes belong to the student, so they stay on when
the character changes.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

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

LEGENDARY = "legendary"
LIMITED = "limited"

# The slots a look has besides its character and skin, each with what can go in it.
HATS: dict[str, dict] = {
    "grad_cap": {"name": "Graduation cap", "tier": RARE, "price": 200},
    "headphones": {"name": "Headphones", "tier": RARE, "price": 200},
    "doppi": {"name": "Doʻppi", "tier": EPIC, "price": 350},
    "crown": {"name": "Crown", "tier": LEGENDARY, "price": 600},
    # On sale only in these months. Once bought they are the student's for good, in or out of
    # season: a season limits the selling, not the wearing.
    "winter_beanie": {"name": "Winter beanie", "tier": LIMITED, "price": 250, "months": (12, 1, 2)},
    "navroz_tulips": {"name": "Navroʻz tulips", "tier": LIMITED, "price": 250, "months": (3,)},
}
FRAMES: dict[str, dict] = {
    "bronze": {"name": "Bronze frame", "tier": COMMON, "price": 150},
    "silver": {"name": "Silver frame", "tier": RARE, "price": 300},
    "gold": {"name": "Gold frame", "tier": EPIC, "price": 500},
    "aurora": {"name": "Aurora frame", "tier": LEGENDARY, "price": 800},
}
EMOTES: dict[str, dict] = {
    "lets_go": {"name": "Let’s go!", "tier": COMMON, "price": 120},
    "on_fire": {"name": "On fire", "tier": COMMON, "price": 120},
    "gg": {"name": "GG", "tier": COMMON, "price": 120},
    "wow": {"name": "Wow", "tier": COMMON, "price": 120},
}
SLOTS: dict[str, dict[str, dict]] = {"hat": HATS, "frame": FRAMES, "emote": EMOTES}


def character_key(character: str) -> str:
    return f"char:{character}"


def skin_key(character: str, tier: str) -> str:
    return f"skin:{character}:{tier}"


def slot_key(slot: str, key: str) -> str:
    return f"{slot}:{key}"


def parse(item_key: str):
    """``("character", key, None)``, ``("skin", key, tier)``, ``("hat", key, None)`` and so on
    for each slot, or None for anything else."""
    parts = str(item_key or "").split(":")
    if len(parts) == 2 and parts[0] == "char" and parts[1] in CHARACTERS:
        return ("character", parts[1], None)
    if len(parts) == 3 and parts[0] == "skin" and parts[1] in CHARACTERS and parts[2] in SKIN_TIERS:
        return ("skin", parts[1], parts[2])
    if len(parts) == 2 and parts[1] in SLOTS.get(parts[0], {}):
        return (parts[0], parts[1], None)
    return None


def price_of(item_key: str) -> int | None:
    parsed = parse(item_key)
    if parsed is None:
        return None
    kind, key, tier = parsed
    if kind == "character":
        return CHARACTERS[key]["price"]
    if kind == "skin":
        return SKIN_PRICES[tier]
    return SLOTS[kind][key]["price"]


def season_of(item_key: str, today: date) -> dict | None:
    """When a limited item can be bought, or None for an item that is always on sale."""
    parsed = parse(item_key)
    months = SLOTS[parsed[0]][parsed[1]].get("months") if parsed and parsed[0] in SLOTS else None
    if not months:
        return None
    if today.month not in months:
        month = today.month
        while month not in months:
            month = month % 12 + 1
        return {"on_sale": False, "days_left": None, "back_in": calendar.month_name[month]}
    days_left = 0
    day = today
    while day.month in months:
        days_left += 1
        day += timedelta(days=1)
    return {"on_sale": True, "days_left": days_left, "back_in": None}


def all_items(today: date) -> list[dict]:
    """Every item in shop order: each character followed by its three skins, then each slot's."""
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
    for slot, items in SLOTS.items():
        for key, info in items.items():
            rows.append(
                {
                    "key": slot_key(slot, key),
                    "kind": slot,
                    # What the frontend draws it from; a hat sits on any character.
                    "character": "",
                    "slot_key": key,
                    "tier": info["tier"],
                    "name": info["name"],
                    "price": info["price"],
                    "starter": False,
                }
            )
            season = season_of(slot_key(slot, key), today)
            if season:
                rows[-1].update(limited=True, **season)
    return rows
