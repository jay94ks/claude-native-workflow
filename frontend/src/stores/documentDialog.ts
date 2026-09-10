import { defineStore } from "pinia";

// 전역 문서 미리보기 다이얼로그 상태 - AppLayout.vue에 DocumentPreviewDialog.vue를
// 한 번만 마운트해두고, 어디서든 이 스토어의 show(code)만 부르면 뜬다
// (메시지/코멘트/질의 본문에 섞인 추적 코드를 클릭했을 때 재사용).
export const useDocumentDialogStore = defineStore("documentDialog", {
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
