# Prisma의 쿼리 엔진이 필요로 하는 libssl - node:22-slim엔 기본으로
# 없어서 "failed to detect the libssl/openssl version" 경고를 내며
# 추측값으로 대체한다(concept 브랜치에서 이미 겪은 문제).
FROM node:22-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# prisma/를 npm ci보다 먼저 복사한다 - package.json의 postinstall이
# db:generate(prisma generate)를 부르는데, 그 스크립트가 prisma/*.prisma
# 스키마 파일을 찾는다. concept 브랜치에서 이 순서를 반대로 뒀다가
# "npm error command failed / npm run db:generate"로 실제 빌드가 깨지는
# 걸 겪은 뒤 고친 교훈을 처음부터 반영.
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

COPY docker-entrypoint.sh ./
# Windows 체크아웃에선 실행 비트가 안 남을 수 있어(git이 항상 보존하진
# 않음) 이미지 안에서 명시적으로 부여(concept 브랜치 tier3에서 이미
# 겪은 문제).
RUN chmod +x docker-entrypoint.sh

EXPOSE 8760

# HOST 환경변수를 docker-compose.yml이 0.0.0.0으로 넘겨준다 - 기본값
# 127.0.0.1은 컨테이너 자신의 루프백이라 같은 compose 네트워크의 다른
# 서비스도, 호스트의 포트 매핑도 못 닿는다. docker-entrypoint.sh가 DB
# 스키마를 반영(prisma db push)한 뒤 서버를 띄운다.
ENTRYPOINT ["./docker-entrypoint.sh"]
