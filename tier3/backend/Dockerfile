# SP-00002 7절 패키징(Docker/Docker Compose). tier2/backend와 달리 이
# 이미지는 **monorepo 루트**를 빌드 컨텍스트로 받는다(docker-compose.yml의
# `context: ../..` 참고) - tier3/backend가 `@claude-native-workflow/
# tier2-backend`를 `file:../../tier2/backend` 의존성으로 참조하기 때문에,
# 두 디렉터리를 지금과 같은 상대 위치(`tier2/backend`, `tier3/backend`)
# 그대로 이미지 안에도 둬야 `npm ci`가 만드는 심볼릭 링크(또는 npm이 대신
# 복사하는 경우도 포함해)가 정상적으로 풀린다. 빌드가 이 이미지 자체
# 안에서 일어나므로(멀티스테이지로 나눠 다른 스테이지에 복사할 필요가 없음)
# symlink 대상 경로가 어긋날 걱정도 없다.
FROM node:22-slim

# tier2/backend의 Prisma 쿼리 엔진이 필요로 하는 libssl (node:22-slim엔
# 기본으로 없음 - tier2/backend/Dockerfile에서 이미 겪은 문제와 동일).
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

COPY tier2/backend ./tier2/backend
COPY tier3/backend ./tier3/backend

WORKDIR /repo/tier2/backend
RUN npm ci
# tier2/backend의 build 스크립트가 3개 provider(mysql/postgres/sqlite)
# Prisma 클라이언트 생성 + tsc를 전부 포함한다 - tier3/backend/src/core/
# db.ts가 런타임에 이 셋 중 DB_DRIVER로 고른 걸 동적 import한다.
RUN npm run build

WORKDIR /repo/tier3/backend
RUN npm ci
RUN npm run build
# Windows 체크아웃에선 실행 비트가 안 남을 수 있어(git이 항상 보존하진
# 않음) 이미지 안에서 명시적으로 부여.
RUN chmod +x docker-entrypoint.sh

EXPOSE 8767

# DATABASE_URL/DB_DRIVER/JWT_SECRET/GITHUB_WEBHOOK_SECRET/TIER3_PROJECTS_DIR는
# docker-compose.yml이 환경변수로 주입한다(SP-00002 7절 "dotenv + 배포
# 플랫폼 기본 시크릿 매니저"). PORT/HOST는 기본값(8767/127.0.0.1)이 있지만,
# 컨테이너 밖(같은 compose 네트워크의 dashboard, 호스트 포트 매핑)에서 붙을
# 수 있어야 하므로 0.0.0.0으로 덮어써야 한다 - docker-entrypoint.sh가 DB
# 스키마를 반영(prisma db push)한 뒤 서버를 그 값으로 띄운다.
ENTRYPOINT ["./docker-entrypoint.sh"]
