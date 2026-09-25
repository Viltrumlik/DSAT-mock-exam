"""Reading app versions — the server half of the iOS app's `AppVersion`.

The two halves must agree to the letter, because they compare the same strings: the policy an
administrator types into the console, and the version the app declares in `X-MasterSAT-Client`.
The rules are the app's (see `ios/MasterSATKit/.../AppOps/AppVersion.swift`):

* the parts are integers, so ``1.10.0`` is newer than ``1.9.0`` — string order says the
  opposite, and a gate built on it would lock out the NEWER app;
* missing parts are zero, so ``1.4`` == ``1.4.0``;
* anything after the leading digits-and-dots is ignored (``2.1.0-rc1``, ``1.3 (40)``);
* anything unreadable is ``None``, and ``None`` never blocks anyone. A gate that cannot read a
  version must fail OPEN: shutting a class out of the app over a malformed header punishes
  students for a mistake that is not theirs.
"""

from __future__ import annotations

import re

Version = tuple[int, int, int]

#: The header the app sends on every request: ``ios/1.1.0`` — optionally followed by a space
#: and anything else (``ios/1.1.0 (2; iOS 26.3)``). Only the platform and the marketing
#: version matter here.
_CLIENT_RE = re.compile(r"^\s*(?P<platform>[A-Za-z]+)/(?P<version>[0-9][0-9.]*)")
_LEADING_RE = re.compile(r"^[0-9.]*")

PLATFORM_IOS = "ios"


def parse_version(raw: object) -> Version | None:
    """``"1.4.2"`` → ``(1, 4, 2)``; ``None`` for anything that is not a version."""
    if not isinstance(raw, str):
        return None
    numeric = _LEADING_RE.match(raw.strip()).group(0)
    if not numeric:
        return None
    parts = numeric.split(".")[:3]
    # "1..2" and a trailing "1." are typos, not versions. Refusing them keeps a slip in the
    # console from quietly meaning "1.0.0".
    if any(part == "" for part in parts):
        return None
    try:
        numbers = [int(part) for part in parts]
    except ValueError:  # pragma: no cover - the regex admits digits only
        return None
    while len(numbers) < 3:
        numbers.append(0)
    return numbers[0], numbers[1], numbers[2]


def format_version(version: Version | None) -> str:
    return "" if version is None else "%d.%d.%d" % version


def parse_client_header(raw: str | None) -> tuple[str, Version | None] | None:
    """``"ios/1.1.0 (2)"`` → ``("ios", (1, 1, 0))``. ``None`` when it is not an app header.

    A test client sends ``ios-test`` and a browser sends nothing; neither is an app with a
    version to judge, and both come back as ``None``.
    """
    if not raw:
        return None
    match = _CLIENT_RE.match(raw)
    if not match:
        return None
    return match.group("platform").lower(), parse_version(match.group("version"))


UPDATE_NONE = "none"
UPDATE_AVAILABLE = "available"
UPDATE_REQUIRED = "required"


def evaluate(current: Version | None, *, minimum: Version | None, latest: Version | None) -> str:
    """Where a build stands: ``none`` / ``available`` / ``required``.

    An unreadable current version is ``none`` — see the module docstring for why that fails
    open. The app runs the same comparison itself and takes the stricter answer.
    """
    if current is None:
        return UPDATE_NONE
    if minimum is not None and current < minimum:
        return UPDATE_REQUIRED
    if latest is not None and current < latest:
        return UPDATE_AVAILABLE
    return UPDATE_NONE
