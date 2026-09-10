#!/bin/sh
# 컨테이너 기동 시 DB 스키마를 현재 DB_DRIVER에 맞는 Prisma 스키마로
# 맞춘다(concept 브랜치의 tier3/backend/docker-entrypoint.sh와 같은
# 패턴 - 이 단계 없이 서버만 띄우면 테이블이 없어 첫 쿼리부터 깨진다.
# 실제로 스키마 push 없이 컨테이너를 띄워보고서야 이 문제를 발견함).
# `db push`(마이그레이션 이력 없이 스키마 정의만으로 실제 DB를 맞추는
# 방식)를 반복 실행해도 스키마가 같으면 아무것도 안 바뀐다.
set -e

case "$DB_DRIVER" in
  postgres) SCHEMA=schema.postgres.prisma ;;
  mysql) SCHEMA=schema.mysql.prisma ;;
  *) SCHEMA=schema.sqlite.prisma ;;
esac

node node_modules/prisma/build/index.js db push \
  --schema "prisma/$SCHEMA" \
  --skip-generate --accept-data-loss

exec node dist/api/server.js
