import { createPinia } from "pinia";
import type { App } from "vue";

// Quasar CLI boot 파일 - defineBoot()의 타입 선언이 이 버전의 quasar
// 패키지에 없어서(quasar/wrappers) 그냥 평범한 default export 함수로 둔다.
export default ({ app }: { app: App }) => {
  app.use(createPinia());
};
