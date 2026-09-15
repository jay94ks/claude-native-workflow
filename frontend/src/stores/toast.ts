import { defineStore } from "pinia";

// 실시간(EMQX) 이벤트를 조용히 무시하지 않고 화면 한 켠에 잠깐
// 알려주는 용도(#realtime-toast) - questionDialog.ts 등과 같은 패턴으로
// AppLayout.vue에 ToastStack.vue를 한 번 마운트해두고 어디서든
// push(text)만 부르면 뜬다. 여러 화면이 동시에 여러 건을 띄울 수
// 있어 dialog 스토어들과 달리 배열로 여러 개를 동시에 들고 있는다.

export interface ToastItem {
  id: number;
  text: string;
}

const AUTO_DISMISS_MS = 5000;
let nextId = 1;

export const useToastStore = defineStore("toast", {
  state: () => ({
    items: [] as ToastItem[],
  }),
  actions: {
    push(text: string): void {
      const id = nextId++;
      this.items.push({ id, text });
      setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
    },
    dismiss(id: number): void {
      this.items = this.items.filter((t) => t.id !== id);
    },
  },
});
