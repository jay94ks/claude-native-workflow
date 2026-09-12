import { defineStore } from "pinia";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function readStoredMode(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

// "system"은 저장되는 설정값일 뿐, 실제로 DOM에 적히는 data-theme
// 속성은 항상 "light"/"dark" 중 하나로 미리 해석해둔다(CSS가
// `:root[data-theme="dark"]`만 보면 되게, prefers-color-scheme 미디어
// 쿼리를 CSS 쪽에 따로 안 둠) - Monaco 에디터처럼 CSS를 안 따라가고
// JS로 직접 테마를 설정해야 하는 위젯도 이 store의 resolved 하나만
// 구독하면 되도록 통일.
export const useThemeStore = defineStore("theme", {
  state: () => ({
    mode: readStoredMode() as ThemeMode,
    resolved: "light" as "light" | "dark",
  }),
  actions: {
    setMode(mode: ThemeMode): void {
      this.mode = mode;
      localStorage.setItem(STORAGE_KEY, mode);
      this.applyResolved();
    },
    cycle(): void {
      const order: ThemeMode[] = ["light", "dark", "system"];
      this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
    },
    applyResolved(): void {
      this.resolved = this.mode === "system" ? (systemPrefersDark() ? "dark" : "light") : this.mode;
      document.documentElement.dataset.theme = this.resolved;
    },
    // App.vue가 기동 시 한 번만 호출 - 초기 적용 + "system" 선택 중일 때
    // OS 설정이 바뀌면 새로고침 없이 따라가도록 리스너 등록.
    init(): void {
      this.applyResolved();
      window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (this.mode === "system") this.applyResolved();
      });
    },
  },
});
