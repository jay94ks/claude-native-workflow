import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 개발 서버(:5173)가 /api를 backend(:8760)로 프록시한다 - 프로덕션에선
// backend가 이 빌드 결과물(dist/)을 같은 오리진에서 정적 서빙하므로
// 브라우저는 항상 상대 경로 /api/...만 호출하면 된다(런타임 API base
// URL 설정이 따로 필요 없음).
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8760",
        changeOrigin: true,
      },
    },
  },
});
