import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { quasar, transformAssetUrls } from "@quasar/vite-plugin";

// dashboard/는 설계자 전용 로컬 도구다(프로젝트 산출물 아님, SP-00001 1절).
// backend/의 로컬 API(기본 8766번 포트)를 호출한다 - 개발 중엔 /api를
// 그쪽으로 프록시해서 CORS 설정 없이 붙인다.
export default defineConfig({
  plugins: [
    vue({ template: { transformAssetUrls } }),
    quasar(),
  ],
  server: {
    port: 9200,
    proxy: {
      "/api": "http://127.0.0.1:8766",
    },
  },
  build: {
    outDir: "dist",
  },
});
