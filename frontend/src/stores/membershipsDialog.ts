import { defineStore } from "pinia";

// 전역 "소속 조회" 다이얼로그 상태 - AppLayout.vue에 MembershipsDialog.vue를
// 한 번만 마운트해두고, 관리자 화면(AdminUsersView.vue)에서 show(userId)만
// 부르면 뜬다(documentDialog.ts와 같은 단방향 다이얼로그 패턴).
export const useMembershipsDialogStore = defineStore("membershipsDialog", {
  state: () => ({
    open: false,
    userId: null as string | null,
    username: null as string | null,
  }),
  actions: {
    show(userId: string, username: string): void {
      this.userId = userId;
      this.username = username;
      this.open = true;
    },
    close(): void {
      this.open = false;
    },
  },
});
