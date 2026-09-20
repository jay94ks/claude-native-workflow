import { createRouter, createWebHistory } from "vue-router";
import routes from "./routes";
import { useAuthStore } from "stores/auth";

// Quasar CLI router 파일 - defineRouter()의 타입 선언이 이 버전의 quasar
// 패키지에 없어서(quasar/wrappers) 그냥 평범한 default export 함수로 둔다.
export default () => {
  const router = createRouter({
    routes,
    history: createWebHistory(),
  });

  // Phase 9: 로그인 안 된 상태로 /login 밖의 경로에 들어오면 튕겨낸다.
  // pinia는 boot 파일에서 이 시점 이전에 이미 app.use()됐으므로 guard
  // 콜백 안에서 useAuthStore()를 불러도 안전하다(모듈 최상단에서 부르지
  // 않는 이유는 이 팩토리 자체는 pinia 설치보다 먼저 실행되기 때문).
  router.beforeEach((to) => {
    const auth = useAuthStore();
    auth.restore();
    if (to.path !== "/login" && !auth.isLoggedIn) return "/login";
    if (to.path === "/login" && auth.isLoggedIn) return "/projects";
    return true;
  });

  return router;
};
