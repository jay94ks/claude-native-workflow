import { defineStore } from "pinia";

// 전역 계획 미리보기 다이얼로그 상태 - documentDialog.ts/kanbanCardDialog.ts와
// 동일 구조(메시지/코멘트/질의 본문에 섞인 PN-XXXXXXXX 코드를 클릭했을
// 때 재사용, TrackingCodeText.vue의 openCode()가 씀).
export const usePlanDialogStore = defineStore("planDialog", {
  state: () => ({
    open: false,
    trackingCode: null as string | null,
  }),
  actions: {
    show(trackingCode: string): void {
      this.trackingCode = trackingCode;
      this.open = true;
    },
    close(): void {
      this.open = false;
    },
  },
});
