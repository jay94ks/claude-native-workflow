# frontend 전용 이미지 - 빌드 결과물(dist/)을 이 이미지 자신의 nginx가
# 정적 서빙한다(#frontend-own-service - 예전엔 backend 이미지에 함께
# 빌드해 backend가 서빙했으나, 별도 compose 서비스로 분리했다). 앞단
# 공용 nginx(루트 nginx/default.conf)가 `/api`는 backend로, `.git`
# 경로는 gitea로, 나머지는 이 서비스로 돌려준다.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
