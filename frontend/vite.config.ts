import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import monacoEditorPlugin from "vite-plugin-monaco-editor-esm";

// 개발 서버(:5173)가 /api를 backend(:8760)로 프록시한다 - 프로덕션에선
// backend가 이 빌드 결과물(dist/)을 같은 오리진에서 정적 서빙하므로
// 브라우저는 항상 상대 경로 /api/...만 호출하면 된다(런타임 API base
// URL 설정이 따로 필요 없음).
//
// Monaco 워커는 처음엔 Vite 공식 문서의 수동 `?worker` import 패턴으로
// 시도했으나, 이 Vite 6 + monaco-editor 조합에서 Rollup이 node_modules
// 안의 `?worker` 쿼리 스펙파이어를 프로덕션 빌드 시 못 풀었다(개발
// 서버에선 되는데 `vite build`만 "Rollup failed to resolve import"로
// 실패 - `optimizeDeps.exclude`/`worker.format` 조정으로도 안 풀림).
// 유지보수되는 전용 플러그인으로 대체.
export default defineConfig({
  plugins: [vue(), monacoEditorPlugin({})],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8760",
        changeOrigin: true,
      },
    },
  },
});
