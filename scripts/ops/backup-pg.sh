#!/usr/bin/env bash
# WorkHub pilot PostgreSQL 备份：docker compose 栈内 pg_dump，按日期命名，保留最近 N 份。
# 用法: bash scripts/ops/backup-pg.sh [备份目录=${WORKHUB_BACKUP_DIR:-../workhub-backups}] [保留份数=14]
# 定时示例(crontab): 0 2 * * * cd /path/to/WorkHub && WORKHUB_BACKUP_DIR=/var/backups/workhub bash scripts/ops/backup-pg.sh
set -euo pipefail

BACKUP_DIR="${1:-${WORKHUB_BACKUP_DIR:-../workhub-backups}}"
KEEP="${2:-14}"
COMPOSE_FILE="docker-compose.pilot.yml"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.pilot}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/workhub-${STAMP}.sql.gz"

COMPOSE_ARGS=()
if [[ -f "${COMPOSE_ENV_FILE}" ]]; then
  COMPOSE_ARGS+=(--env-file "${COMPOSE_ENV_FILE}")
fi
COMPOSE_ARGS+=(-f "${COMPOSE_FILE}")

mkdir -p "${BACKUP_DIR}"
docker compose "${COMPOSE_ARGS[@]}" exec -T postgres \
  pg_dump -U workhub -d workhub --no-owner --no-privileges \
  | gzip > "${OUT}"

echo "backup written: ${OUT} ($(du -h "${OUT}" | cut -f1))"

# 轮转：只保留最近 KEEP 份
ls -1t "${BACKUP_DIR}"/workhub-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "retained $(ls -1 "${BACKUP_DIR}"/workhub-*.sql.gz 2>/dev/null | wc -l | tr -d ' ') backup(s) in ${BACKUP_DIR}"
