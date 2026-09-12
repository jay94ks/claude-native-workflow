# 빌드 컨텍스트가 저장소 루트다(docker-compose.yml에서 context: ../..로
# 바꿈 - Phase 5 전엔 backend/만 컨텍스트였지만, frontend/도 같은
# 이미지에 넣어야 해서 확장했다). 모든 COPY 경로가 backend/ 또는
# frontend/ 접두사를 갖는 이유.

# --- frontend 빌드 스테이지 ---
# 별도 컨테이너/포트로 안 띄운다 - backend가 이 결과물을 그대로 정적
# 서빙한다("단일 설치형" 원칙).
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

# --- backend 빌드 + 최종 이미지 ---
# Prisma의 쿼리 엔진이 필요로 하는 libssl - node:22-slim엔 기본으로
# 없어서 "failed to detect the libssl/openssl version" 경고를 내며
# 추측값으로 대체한다(concept 브랜치에서 이미 겪은 문제).
FROM node:22-slim

# git은 애플리케이션 런타임엔 필요 없지만(clone/push는 항상 설계자가
# 직접 함), scripts/migrate-gitea-namespaces.ts의 transfer-API 폴백
# (git clone --mirror + push --mirror로 히스토리를 그대로 복사)이
# 컨테이너 안에서 직접 실행되므로 필요하다.
RUN apt-get update -y && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
# prisma/를 npm ci보다 먼저 복사한다 - package.json의 postinstall이
# db:generate(prisma generate)를 부르는데, 그 스크립트가 prisma/*.prisma
# 스키마 파일을 찾는다. concept 브랜치에서 이 순서를 반대로 뒀다가
# "npm error command failed / npm run db:generate"로 실제 빌드가 깨지는
# 걸 겪은 뒤 고친 교훈을 처음부터 반영.
COPY backend/prisma ./prisma
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
# 1회성 마이그레이션/검증 스크립트(예: migrate-gitea-namespaces.ts) -
# `docker compose exec backend npm run migrate:gitea-namespaces`로
# 컨테이너 안에서 직접 실행하기 위해 이미지에 포함한다(tsx로 그대로
# 실행 - 별도 컴파일 단계 없음, audit-cli-mcp.ts와 동일).
COPY backend/scripts ./scripts

RUN npm run build

COPY backend/docker-entrypoint.sh ./
# Windows 체크아웃에선 실행 비트가 안 남을 수 있어(git이 항상 보존하진
# 않음) 이미지 안에서 명시적으로 부여(concept 브랜치 tier3에서 이미
# 겪은 문제).
RUN chmod +x docker-entrypoint.sh

# server.ts가 dist/api/server.js 기준 3단계 위(로컬 개발에서
# backend/dist/api → repo 루트와 같은 상대 위치)의 frontend/dist를
# 찾는다 - 컨테이너에서는 /app이 backend/ 역할이므로 /frontend/dist에
# 둬야 그 상대 경로 계산과 맞아떨어진다.
COPY --from=frontend-build /app/frontend/dist /frontend/dist

EXPOSE 8760

# HOST 환경변수를 docker-compose.yml이 0.0.0.0으로 넘겨준다 - 기본값
# 127.0.0.1은 컨테이너 자신의 루프백이라 같은 compose 네트워크의 다른
# 서비스도, 호스트의 포트 매핑도 못 닿는다. docker-entrypoint.sh가 DB
# 스키마를 반영(prisma db push)한 뒤 서버를 띄운다.
ENTRYPOINT ["./docker-entrypoint.sh"]
