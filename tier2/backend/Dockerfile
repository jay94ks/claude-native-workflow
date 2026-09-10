# SP-00001 7절 패키징. 단일 스테이지로 devDependencies까지 그대로 남겨둔다 -
# `docs db enable/disable`(선택적 서비스 DB, PL-00001 2단계 8번)가 런타임에
# `node_modules/prisma`(devDependency)의 CLI 진입점을 직접 실행하므로,
# 실행 이미지에서 devDependencies를 잘라내면 그 기능이 컨테이너 안에서
# 깨진다 - 로컬/자체 호스팅 도구라 이미지 크기보다 이 쪽을 우선했다.
FROM node:22-slim

# Prisma의 쿼리 엔진(선택적 서비스 DB, PL-00001 2단계 8번)이 필요로 하는
# libssl - node:22-slim엔 기본으로 없어서 `prisma generate`가 빌드 중
# "failed to detect the libssl/openssl version" 경고를 내며 추측값으로
# 대체한다. 실제로 이 이미지를 빌드해보고서야 드러난 문제.
#
# QA로 발견: git도 마찬가지로 node:22-slim엔 기본 설치돼 있지 않은데,
# 이 서버는 문서 생성/저장/답변마다 자동으로 git commit을 한다(SP-00001
# 5절 - 이 워크플로우의 핵심 기능). git 없이 실제 이미지를 빌드해
# 컨테이너 안에서 문서를 하나 만들어보고서야 "spawn git ENOENT"로 바로
# 깨지는 걸 확인 - 이제까지의 도커 검증은 대부분 npm run dev(로컬
# node/git 그대로 사용)로 이뤄져서 이 이미지 자체로 안 걸렸던 것.
RUN apt-get update -y && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

RUN npm run build

EXPOSE 8766

# --root는 docker-compose.yml이 마운트하는 프로젝트 루트를 가리킨다.
# --host 0.0.0.0: 기본값 127.0.0.1은 컨테이너 자신의 루프백이라 같은 compose
# 네트워크의 dashboard(nginx)도, 호스트의 포트 매핑도 못 닿는다 - 노출 범위는
# 이미 docker-compose.yml의 ports: 매핑이 결정하므로 여기서의 0.0.0.0은
# 안전하다.
CMD ["node", "dist/api/server.js", "--port", "8766", "--host", "0.0.0.0", "--root", "/workspace"]
