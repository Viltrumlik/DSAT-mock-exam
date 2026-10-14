"""A stand-in for ``LcupClient`` in tests. Never touches the network, the cache or credentials."""

#: The key in a FakeLcupClient's ``data`` that answers ``post_attendance``.
POST_ATTENDANCE = "POST /attendance"


class FakeLcupClient:
    """Answers from a dict keyed by path.

    A value may be a list (rows, for ``fetch_all`` or as a ``get`` body's ``data``), a dict (a
    whole ``get`` body) or an ``Exception`` instance, which is raised. Every call is recorded in
    ``.calls`` as ``(path, params)``.
    """

    def __init__(self, data: dict):
        self.data = data
        self.calls: list[tuple[str, dict]] = []
        self.posts: list[tuple] = []

    def _lookup(self, path, params):
        self.calls.append((path, dict(params or {})))
        value = self.data.get(path, [])
        if isinstance(value, Exception):
            raise value
        return value

    def get(self, path, params=None) -> dict:
        value = self._lookup(path, params)
        return value if isinstance(value, dict) else {"success": True, "data": list(value)}

    def fetch_all(self, path, params=None) -> list[dict]:
        value = self._lookup(path, params)
        return list(value.get("data", [])) if isinstance(value, dict) else list(value)

    def post_attendance(self, group_id, day, records) -> dict:
        """Recorded in ``.posts`` as ``(group_id, day, records)``. ``data["POST /attendance"]`` may
        be an ``Exception`` (raised), a callable ``(group_id, day, records) -> dict``, or a dict;
        absent, lc-up "saves" every record. The real switch is honoured, as the client does."""
        from .client import LcupError
        from .conf import attendance_push_enabled

        if not attendance_push_enabled():
            raise LcupError("attendance push is switched off")
        self.posts.append((group_id, day, [dict(r) for r in records]))
        answer = self.data.get(POST_ATTENDANCE)
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(group_id, day, records)
        if isinstance(answer, dict):
            return answer
        results = [{"student_id": r["student_id"], "status": r["status"], "result": "saved", "error": None} for r in records]
        return {"group_id": group_id, "date": day.isoformat(), "results": results,
                "summary": {"saved": len(records), "deleted": 0, "unchanged": 0, "failed": 0}}
