// 워커 등록은 vite.config.ts의 vite-plugin-monaco-editor-esm이
// 대신한다(수동 `?worker` import가 이 Vite 버전 조합에서 프로덕션
// 빌드에 실패해서 플러그인으로 교체한 이유는 vite.config.ts 주석
// 참고) - 여기서는 monaco 자체만 다시 내보낸다.
export * as monaco from "monaco-editor";
