import { defineStore } from "pinia";

// 사이드바 검색창 → 범위 선택 팝업(SearchScopeDialog.vue) 사이의 상태.
// entityPicker.ts와 달리 Promise를 안 쓴다 - "검색 실행"을 누르면 그냥
// 검색 결과 페이지로 라우터 이동하고 닫힐 뿐, 호출부(SidebarSearchBox)가
// 결과를 기다릴 필요가 없다.
export const useSearchScopeStore = defineStore("searchScope", {
  state: () => ({
    open: false,
    keyword: "",
    projectId: null as string | null,
  }),
  actions: {
    openWith(keyword: string, projectId: string): void {
      if (!keyword.trim()) return;
      this.keyword = keyword.trim();
      this.projectId = projectId;
      this.open = true;
    },
    close(): void {
      this.open = false;
    },
  },
});
