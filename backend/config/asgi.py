"""
ASGI config for config project.

Two protocols, and only one of them is used by the site you are looking at:

``http``
    Plain Django. Nothing serves the site over this in production — gunicorn serves every
    HTTP request from ``config.wsgi``. It is here so
    ``uvicorn config.asgi:application`` is a complete server in development.

``websocket``
    The live quiz, and only the live quiz. Terminated by a separate uvicorn process on its
    own port (``deploy/ecosystem.config.js``: ``sat-livequiz``), which nginx routes ``/ws/``
    to. Keeping sockets out of the gunicorn process is the whole point: the SSE endpoint
    parked one of three sync workers per client in August 2026 and took the site down with
    it. A socket here cannot do that, because it is not in that process.

Every socket passes through :func:`livequiz.auth.livequiz_auth_stack`, which refuses a
handshake from an origin that is not ours before it authenticates anybody.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# The HTTP application has to be built before anything imports a consumer, because importing
# a consumer imports models, and models need the app registry populated.
django_asgi_application = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from livequiz.auth import livequiz_auth_stack  # noqa: E402
from livequiz.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_application,
        "websocket": livequiz_auth_stack(URLRouter(websocket_urlpatterns)),
    }
)
