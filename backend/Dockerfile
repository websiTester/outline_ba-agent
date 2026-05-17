# syntax=docker/dockerfile:1.6
# ─────────────────────────────────────────────────────────────
# Stage 1 — Builder: compile wheels with full build toolchain
# ─────────────────────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System libraries needed to compile lxml, cryptography, pdfplumber, asyncpg, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        libpq-dev \
        libxml2-dev \
        libxslt1-dev \
        libffi-dev \
        libssl-dev \
        libjpeg-dev \
        zlib1g-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt ./

# Build wheels into /wheels — these get copied into the runtime image
RUN pip wheel --wheel-dir=/wheels -r requirements.txt

# ─────────────────────────────────────────────────────────────
# Stage 2 — Runtime: minimal image, no compilers
# ─────────────────────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LIGHTRAG_WORKING_DIR=/app/working_dir

# Runtime-only system libraries (no -dev packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        libxml2 \
        libxslt1.1 \
        libjpeg62-turbo \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --gid 1001 fastapi && \
    useradd --uid 1001 --gid fastapi --shell /bin/bash --create-home fastapi

WORKDIR /app

# Install pre-built wheels from builder stage
COPY --from=builder /wheels /wheels
COPY requirements.txt ./
RUN pip install --no-index --find-links=/wheels -r requirements.txt && \
    rm -rf /wheels

# Copy application source (excludes .venv, __pycache__ via .dockerignore)
COPY --chown=fastapi:fastapi . /app

# Persistent state directory for LightRAG (mounted as volume in production)
RUN mkdir -p /app/working_dir && chown -R fastapi:fastapi /app/working_dir

USER fastapi

EXPOSE 8000

# Healthcheck hits the /health endpoint defined in main.py
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Production: no --reload, 1 worker (LightRAG holds in-memory state per worker)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
