import { defineStore } from "pinia";

// kanbanCardDialog.ts/documentDialog.ts와 동일한 모양 - TrackingCodeText.vue가
// 매치된 코드의 접두어("QU-")로 이 스토어로 분기한다. AppLayout.vue에
// QuestionDialog.vue를 한 번 마운트해두고 어디서든 show(trackingCode)만
// 부르면 뜬다.
export const useQuestionDialogStore = defineStore("questionDialog", {
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
