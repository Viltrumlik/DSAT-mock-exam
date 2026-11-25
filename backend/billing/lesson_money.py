"""What a lesson cancelled or moved does to the money (owner, 2026-11-25). Stubbed until the billing half lands."""


def apply(change, *, today, by) -> dict:
    return {"voided": 0, "students": 0, "amount": 0, "unfrozen": 0, "frozen": 0}


def revert(change, *, today, by) -> dict:
    return {"voided": 0, "students": 0, "amount": 0, "unfrozen": 0, "frozen": 0}
