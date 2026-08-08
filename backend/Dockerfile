# Django + Celery, one image, three commands (gunicorn / worker / beat) — same code, same
# dependencies, which is the point: the drift this replaces was three PM2 processes pointed at
# a venv built separately on the box.
#
# Chromium is baked in. `playwright install chromium` is a hand-run step on the current server
# and has been forgotten before — midterm certificates render through it, so when it is missing
# the failure is a student's certificate, not a startup error. An image cannot forget.
#
# Python 3.12 to match CI (.github/workflows/*) and the developers' local venv.

# ── builder ───────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# psycopg2-binary ships wheels, but Pillow and a few others still want a compiler on slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN python -m venv /venv \
    && /venv/bin/pip install --upgrade pip \
    && /venv/bin/pip install -r requirements.txt

# ── runtime ───────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=config.settings \
    PATH="/venv/bin:$PATH" \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /venv /venv

# `--with-deps` pulls the shared libraries headless Chromium needs; on slim they are not there.
RUN playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# A non-root user, and one that owns nothing it does not need to write. Media and the beat
# schedule are bind-mounted from the host's shared/ dir at runtime (see compose.yaml).
RUN useradd --create-home --uid 10001 satapp
WORKDIR /app
COPY --chown=satapp:satapp . /app

# collectstatic at build time, not on every boot: the inputs are in the image, so the output
# is too, and three containers starting from one image must not race each other writing it.
# A dummy key because settings refuses to import without one; nothing secret is baked.
RUN SECRET_KEY=build-only DEBUG=False ALLOWED_HOSTS=localhost \
    python manage.py collectstatic --noinput \
    && chown -R satapp:satapp /app/staticfiles

USER satapp
EXPOSE 8000

# Overridden per service in compose.yaml. This default is the web one.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--timeout", "120", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
