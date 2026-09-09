# SP-00001 7절 패키징. 빌드 스테이지에서 정적 파일을 만들고, nginx로 서빙 -
# dashboard는 순수 프론트엔드라 backend와 달리 런타임 devDependencies가
# 필요 없다(prod 이미지에 node/npm이 아예 없음).
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
