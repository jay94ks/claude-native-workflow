import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { quasar, transformAssetUrls } from "@quasar/vite-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SP-00002 8절: "화면 자체는 SP-00001과 동일" - 문서 조회/편집 화면은
// tier2/dashboard의 Vue 컴포넌트를 새로 베끼지 않고 그대로 import해서
// 쓴다(../../tier2/dashboard/src/...). Vite 기본 설정은 프로젝트 루트
// 밖의 파일을 dev 서버가 못 읽게 막아서(server.fs.allow), 그 경로를
// 명시적으로 허용해야 한다.
export default defineConfig({
  plugins: [
    vue({ template: { transformAssetUrls } }),
    quasar(),
  ],
  server: {
    port: 9300,
    fs: {
      allow: [__dirname, path.resolve(__dirname, "../../tier2/dashboard")],
    },
    proxy: {
      "/api": "http://127.0.0.1:8767",
    },
  },
  build: {
    outDir: "dist",
  },
});
