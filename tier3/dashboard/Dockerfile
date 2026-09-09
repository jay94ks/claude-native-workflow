# SP-00002 7/8절 패키징. tier2/dashboard/Dockerfile과 달리 이 이미지도
# **monorepo 루트**를 빌드 컨텍스트로 받는다 - tier3/dashboard가
# `../../../../tier2/dashboard/src/...` 상대경로로 tier2 컴포넌트를 직접
# import하기 때문에, 그 소스가 빌드 시점에 같은 상대 위치에 있어야 한다.
# 소스가 import하는 npm 패키지(marked/vue/quasar)의 module resolution은
# "import하는 파일 기준으로 위쪽 node_modules를 찾는" 방식이라, tier2/
# dashboard 소스 자체도 자기 node_modules가 있어야 한다(tier3/dashboard의
# node_modules는 그 파일 입장에서 형제 디렉터리라 안 잡힘 - 로컬 dev에서
# 안 보이던 문제인 이유는 tier2/dashboard가 이미 별도로 npm install돼
# 있었기 때문. 이미지 빌드 중 실제로 이 실패를 재현하고서 알아낸 원인).
FROM node:22-slim AS build

WORKDIR /repo

COPY tier2/dashboard ./tier2/dashboard
COPY tier3/dashboard ./tier3/dashboard

WORKDIR /repo/tier2/dashboard
RUN npm ci

WORKDIR /repo/tier3/dashboard
RUN npm ci
RUN npm run build

FROM nginx:alpine
COPY --from=build /repo/tier3/dashboard/dist /usr/share/nginx/html
COPY tier3/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
