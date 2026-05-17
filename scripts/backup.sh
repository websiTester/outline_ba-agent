#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Daily backup of Postgres + Neo4j + LightRAG working_dir
# → uploads to Azure Blob Storage container `outline-backups`
# → pings Healthchecks.io on success/failure
#
# Schedule: cron `0 19 * * *` (UTC) = 02:00 VN time
# Retention: 7 days (managed by Azure Blob lifecycle policy)
#
# Required env (load via /opt/outline-ba/.env or systemd EnvironmentFile):
#   AZURE_STORAGE_ACCOUNT_NAME
#   AZURE_STORAGE_ACCESS_KEY
#   POSTGRES_PASSWORD
#   NEO4J_PASSWORD
#   BACKUP_HC_PING_URL        (Healthchecks.io check URL)
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# Load env from the same .env the containers use
if [[ -f /opt/outline-ba/.env ]]; then
    set -a
    # shellcheck disable=SC1091
    source /opt/outline-ba/.env
    set +a
fi

: "${AZURE_STORAGE_ACCOUNT_NAME:?missing}"
: "${AZURE_STORAGE_ACCESS_KEY:?missing}"
: "${POSTGRES_PASSWORD:?missing}"
: "${NEO4J_PASSWORD:?missing}"

TS="$(date -u +%Y%m%d-%H%M%S)"
CONTAINER="outline-backups"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Healthchecks.io: ping /start to indicate job began
if [[ -n "${BACKUP_HC_PING_URL:-}" ]]; then
    curl -fsS -m 10 "${BACKUP_HC_PING_URL}/start" > /dev/null || true
fi

log() { echo "[$(date -u +%FT%TZ)] $*"; }

fail() {
    log "❌ FAILED: $*"
    if [[ -n "${BACKUP_HC_PING_URL:-}" ]]; then
        curl -fsS -m 10 --data-raw "$*" "${BACKUP_HC_PING_URL}/fail" > /dev/null || true
    fi
    exit 1
}

upload() {
    local localfile="$1" blobname="$2"
    az storage blob upload \
        --account-name "$AZURE_STORAGE_ACCOUNT_NAME" \
        --account-key "$AZURE_STORAGE_ACCESS_KEY" \
        --container-name "$CONTAINER" \
        --file "$localfile" \
        --name "$blobname" \
        --overwrite false \
        --output none
}

# ─── Postgres ───
log "Dumping Postgres..."
PG_FILE="$TMPDIR/pg-${TS}.sql.gz"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    pg_dump -U outline -d outline --no-owner --clean --if-exists \
    | gzip -9 > "$PG_FILE" \
    || fail "Postgres dump"
upload "$PG_FILE" "postgres/pg-${TS}.sql.gz" || fail "Postgres upload"
log "✅ Postgres backup uploaded ($(stat -c%s "$PG_FILE") bytes)"

# ─── Neo4j (online dump via cypher-shell APOC export → fallback to offline dump) ───
log "Dumping Neo4j..."
NEO4J_FILE="$TMPDIR/neo4j-${TS}.dump.gz"
if docker exec neo4j neo4j-admin database dump neo4j --to-stdout 2>/dev/null \
    | gzip -9 > "$NEO4J_FILE"; then
    log "✅ Neo4j online dump succeeded"
else
    # Fallback: stop Neo4j briefly, dump offline, restart
    log "⚠️  Online dump failed, falling back to offline dump (will cause ~30s downtime)"
    docker stop neo4j
    docker run --rm \
        -v outline_neo4j_data:/data \
        neo4j:5-community \
        neo4j-admin database dump neo4j --to-stdout \
        | gzip -9 > "$NEO4J_FILE" \
        || { docker start neo4j; fail "Neo4j offline dump"; }
    docker start neo4j
fi
upload "$NEO4J_FILE" "neo4j/neo4j-${TS}.dump.gz" || fail "Neo4j upload"
log "✅ Neo4j backup uploaded ($(stat -c%s "$NEO4J_FILE") bytes)"

# ─── LightRAG working_dir ───
log "Archiving LightRAG working_dir..."
LR_FILE="$TMPDIR/lightrag-${TS}.tar.gz"
docker run --rm \
    -v outline_fastapi_working_dir:/working_dir:ro \
    -v "$TMPDIR:/out" \
    alpine:3 \
    tar -czf "/out/lightrag-${TS}.tar.gz" -C /working_dir . \
    || fail "LightRAG archive"
upload "$LR_FILE" "lightrag/lightrag-${TS}.tar.gz" || fail "LightRAG upload"
log "✅ LightRAG backup uploaded ($(stat -c%s "$LR_FILE") bytes)"

# ─── Success ping ───
log "🎉 All backups complete for ${TS}"
if [[ -n "${BACKUP_HC_PING_URL:-}" ]]; then
    curl -fsS -m 10 "$BACKUP_HC_PING_URL" > /dev/null || true
fi
