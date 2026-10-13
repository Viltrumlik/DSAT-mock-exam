"""A stand-in for ``LcupClient`` in tests. Never touches the network, the cache or credentials."""


class FakeLcupClient:
    """Answers from a dict keyed by path.

    A value may be a list (rows, for ``fetch_all`` or as a ``get`` body's ``data``), a dict (a
    whole ``get`` body) or an ``Exception`` instance, which is raised. Every call is recorded in
    ``.calls`` as ``(path, params)``.
    """

    def __init__(self, data: dict):
        self.data = data
        self.calls: list[tuple[str, dict]] = []

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
