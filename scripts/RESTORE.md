# Restore Runbook — Outline-BA

Khi disaster xảy ra (VM die, DB corrupt, data loss), follow runbook này để khôi phục từ Azure Blob backup.

**RTO target:** 4h. Thực tế từng bước dưới ~30 phút.

## Tiền điều kiện

- Có Azure VM mới (hoặc VM cũ vẫn chạy được)
- Đã clone repo `outline-ba` về `/opt/outline-ba`
- Đã có `.env` (re-render từ GitHub Secrets nếu mất)
- `az` CLI đã `login` với account có quyền đọc Storage Account

## 1) Liệt kê backup khả dụng

```bash
az storage blob list \
    --account-name "$AZURE_STORAGE_ACCOUNT_NAME" \
    --account-key "$AZURE_STORAGE_ACCESS_KEY" \
    --container-name outline-backups \
    --output table \
    --query "[].{name:name, size:properties.contentLength, modified:properties.lastModified}"
```

Chọn timestamp gần nhất (vd `20260515-190015`).

## 2) Stop ứng dụng (tránh ghi đè khi restore)

```bash
cd /opt/outline-ba
docker compose -f docker-compose.prod.yml stop outline fastapi
```

DB containers (postgres, neo4j) **vẫn chạy** để có thể restore.

## 3) Download các blob về local

```bash
TS=20260515-190015   # ← thay bằng timestamp bạn chọn
mkdir -p /tmp/restore
cd /tmp/restore

for blob in "postgres/pg-${TS}.sql.gz" "neo4j/neo4j-${TS}.dump.gz" "lightrag/lightrag-${TS}.tar.gz"; do
    az storage blob download \
        --account-name "$AZURE_STORAGE_ACCOUNT_NAME" \
        --account-key "$AZURE_STORAGE_ACCESS_KEY" \
        --container-name outline-backups \
        --name "$blob" \
        --file "$(basename "$blob")"
done

ls -lh
```

## 4) Restore Postgres

```bash
# Drop existing DB content (the dump uses --clean --if-exists, so this is also OK)
gunzip -c "/tmp/restore/pg-${TS}.sql.gz" | \
    docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    psql -U outline -d outline
```

Verify:

```bash
docker exec postgres psql -U outline -d outline -c "SELECT count(*) FROM users;"
docker exec postgres psql -U outline -d outline -c "SELECT count(*) FROM documents;"
```

## 5) Restore Neo4j

```bash
# Stop Neo4j to allow offline load
docker compose -f /opt/outline-ba/docker-compose.prod.yml stop neo4j

# Load dump from stdin
gunzip -c "/tmp/restore/neo4j-${TS}.dump.gz" | \
    docker run --rm -i \
    -v outline_neo4j_data:/data \
    neo4j:5-community \
    neo4j-admin database load neo4j --from-stdin --overwrite-destination=true

# Start Neo4j again
docker compose -f /opt/outline-ba/docker-compose.prod.yml start neo4j
```

Verify (chờ ~30s cho Neo4j start):

```bash
docker exec neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" \
    "MATCH (n) RETURN count(n) AS node_count;"
```

## 6) Restore LightRAG working_dir

```bash
# Clear current working_dir volume
docker run --rm -v outline_fastapi_working_dir:/wd alpine:3 sh -c "rm -rf /wd/* /wd/.[!.]* 2>/dev/null || true"

# Extract backup into volume
docker run --rm \
    -v outline_fastapi_working_dir:/wd \
    -v /tmp/restore:/in:ro \
    alpine:3 \
    tar -xzf "/in/lightrag-${TS}.tar.gz" -C /wd
```

## 7) Start ứng dụng

```bash
cd /opt/outline-ba
docker compose -f docker-compose.prod.yml start outline fastapi
```

## 8) Verify end-to-end

```bash
curl -fsS https://windyselfhost.online/_health    # → "OK"
curl -fsS https://api.windyselfhost.online/health  # → {"status":"ok"}
```

Login Google vào UI, mở 1 document đã có trước disaster, thử search trong Knowledge Graph để verify Neo4j data + LightRAG cache.

## 9) Cleanup

```bash
rm -rf /tmp/restore
docker image prune -f
```

## Edge cases

- **Backup blob bị corrupt:** thử blob ngày liền kề trước. Nếu vẫn fail → cảnh báo team, dùng blob xa hơn.
- **Postgres restore lỗi extension `vector`:** chạy `CREATE EXTENSION IF NOT EXISTS vector;` trước khi restore.
- **Neo4j load lỗi version mismatch:** đảm bảo image `neo4j:5-community` cùng version với lúc backup.
- **VM mới có IP khác:** update A record ở Tenten DNS, chờ propagation, sau đó Caddy sẽ tự xin lại cert (max 50 cert/tuần/domain rate limit).
- **Mất Caddy cert volume `caddy_data`:** Let's Encrypt sẽ tự xin lại lần đầu request — chỉ là tốn ~5s thêm latency cho request đầu tiên.
