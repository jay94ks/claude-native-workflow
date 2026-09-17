import { defineStore } from "pinia";

// 네이티브 window.confirm() 대신 쓰는 공용 확인 다이얼로그
// (#frontend-confirm-dialog-unify, BL-57F8DF17 #70) - 조사해보니
// questionDialog.ts는 AI가 설계자에게 묻는 질의(Q&A)를 보여주는
// 전혀 다른 개념이라("이미 있는 QuestionDialog로 통일"이라는 원래
// 백로그 서술은 오해였음) 재사용할 수 없었고, 이 용도의 범용 확인
// 스토어 자체가 없어서 새로 만들었다. `confirm(message)`가
// Promise<boolean>을 반환해 `await`로 자연스럽게 게이팅할 수 있다 -
// window.confirm()의 동기 반환값을 그대로 대체.
export const useConfirmDialogStore = defineStore("confirmDialog", {
  state: () => ({
    open: false,
    message: "",
    resolver: null as ((value: boolean) => void) | null,
  }),
  actions: {
    confirm(message: string): Promise<boolean> {
      // 다이얼로그가 이미 떠 있는 채로 또 호출되면(드문 경우) 이전
      // 호출은 "취소"로 정리하고 새 확인을 시작한다 - resolver를
      // 잃어버려 영원히 pending으로 남는 Promise가 생기지 않게.
      this.resolver?.(false);
      this.message = message;
      this.open = true;
      return new Promise((resolve) => {
        this.resolver = resolve;
      });
    },
    resolve(value: boolean): void {
      this.open = false;
      const r = this.resolver;
      this.resolver = null;
      r?.(value);
    },
  },
});
