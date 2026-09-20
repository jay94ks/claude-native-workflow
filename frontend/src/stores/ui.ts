import { defineStore } from "pinia";

// 반응형 시나리오(설계자 요청, 2026-09-21) - 좁은 화면에서 270px 좌측
// 패널(코드/PR/이슈/문서/트래커/설정 탭 공용)을 오프캔버스로 숨기고
// 로고 좌측 햄버거로 토글한다. 전역 store로 두는 이유는 햄버거 버튼
// (MainLayout)과 좌측 패널(각 프로젝트 하위 페이지)이 서로 다른
// 컴포넌트 트리에 있어 prop으로 못 엮기 때문.
export const useUiStore = defineStore("ui", {
  state: () => ({
    sidebarOpen: false,
  }),
  actions: {
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },
    closeSidebar() {
      this.sidebarOpen = false;
    },
  },
});
