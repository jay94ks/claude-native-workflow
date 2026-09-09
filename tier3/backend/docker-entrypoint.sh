#!/bin/sh
# 컨테이너 기동 시 DB 스키마를 현재 DB_DRIVER에 맞는 Prisma 스키마로
# 맞춘다(SP-00002 6절: Tier 3는 DB 활성화가 기본값 - 비활성 옵션이 없으므로
# 스키마가 안 맞으면 아예 못 뜬다). 이 저장소는 Prisma Migrate 대신
# `db push`를 계속 써왔다(2단계 8번 선택적 서비스 DB, 이번 세션 스크래치
# 테스트 전부 동일) - 마이그레이션 이력 파일 없이 스키마 정의만으로 실제
# DB를 맞추는 방식이라 운영 중 반복 실행해도 스키마가 같으면 아무것도 안
# 바뀐다(변경분이 있을 때만 반영, 데이터 컬럼 삭제처럼 손실이 나는 변경은
# --accept-data-loss로 허용 - 지금 스키마엔 그런 변경이 없지만 최초 배포
# 자동화를 막지 않기 위해 켜둔다).
set -e

case "$DB_DRIVER" in
  postgres) SCHEMA=schema.postgres.prisma ;;
  sqlite) SCHEMA=schema.sqlite.prisma ;;
  *) SCHEMA=schema.mysql.prisma ;;
esac

node /repo/tier2/backend/node_modules/prisma/build/index.js db push \
  --schema "/repo/tier2/backend/prisma/$SCHEMA" \
  --skip-generate --accept-data-loss

exec node dist/api/server.js
