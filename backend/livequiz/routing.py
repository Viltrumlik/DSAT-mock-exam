"""WebSocket URLs for the live quiz.

The session id is in the path, never the join code: a URL ends up in logs and in a browser's
history, and the code is the thing that lets somebody into the room. Joining happens over
REST, where the code is checked once and exchanged for an id.
"""

from __future__ import annotations

from django.urls import re_path

from .consumers import LiveQuizConsumer

websocket_urlpatterns = [
    re_path(r"^ws/livequiz/(?P<session_id>\d+)/$", LiveQuizConsumer.as_asgi()),
]
