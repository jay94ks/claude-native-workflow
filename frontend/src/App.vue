<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { useThemeStore } from "./stores/theme";
import AppLayout from "./components/AppLayout.vue";

const route = useRoute();
const auth = useAuthStore();
const showLayout = computed(() => auth.loggedIn && !route.meta.public);

useThemeStore().init();
</script>

<template>
  <AppLayout v-if="showLayout">
    <router-view />
  </AppLayout>
  <router-view v-else />
</template>

<style>
/* 라이트 모드 기본값(#responsive-dark-mode 1단계) - 46개 컴포넌트에
   흩어진 하드코딩 hex 값을 한 번에 옮길 수는 없어 셸+대표 화면
   몇 개부터 이 토큰을 쓰도록 전환하고, 나머지는 후속 라운드에서
   순차 전환한다(DESIGN-NOTES.md 참고). 다크 값은 :root[data-theme="dark"]
   에서만 재정의 - "system" 모드는 stores/theme.ts가 JS에서 미리
   light/dark 중 하나로 해석해 이 속성에 적어주므로 별도 미디어
   쿼리가 필요 없다. */
:root {
  --color-bg: #f6f7f9;
  --color-surface: #fff;
  --color-surface-hover: #f0f1f5;
  --color-text: #1a1a2e;
  --color-text-secondary: #555;
  --color-text-muted: #888;
  --color-text-faint: #999;
  --color-border: #d8dae0;
  --color-border-light: #eee;
  --color-primary: #3454d1;
  --color-danger: #d1344b;
  --color-success: #1f9254;
  --color-success-bg: #e3f6ec;
  --color-warning-text: #8a6300;
  --color-warning-bg: #fff8e1;
  --color-warning-border: #f0c14b;
  --color-info-bg: #f0f3ff;
  --color-info-border: #c7d2f5;
  --color-primary-muted: #a9b4e0;
  --color-danger-border: #f0c7d0;
  --color-danger-border-strong: #e2a2ad;
  --color-mark-bg: #fdf0a8;
  --color-terminal-bg: #1a1a2e;
  --color-terminal-text: #d6f8d6;
  --color-tcode-hover-bg: #e4e9fb;
  --color-diff-add-bg: #e6ffec;
  --color-diff-del-bg: #ffeef0;
  --color-sidebar-bg: #1a1a2e;
  --color-sidebar-text: #fff;
  --color-sidebar-muted: #c7c9e8;
  --color-sidebar-faint: #8688a8;
  --color-sidebar-hover: #2e2f4d;
  --color-sidebar-border: #454668;
  --color-sidebar-input-bg: #24253f;
  --color-sidebar-error: #ff8a9b;
}
:root[data-theme="dark"] {
  --color-bg: #14151f;
  --color-surface: #1c1d2b;
  --color-surface-hover: #262838;
  --color-text: #e4e5f1;
  --color-text-secondary: #b8bacb;
  --color-text-muted: #8b8da3;
  --color-text-faint: #6f7186;
  --color-border: #34364a;
  --color-border-light: #2a2c3d;
  --color-primary: #7c96e8;
  --color-danger: #e2596f;
  --color-success: #35b871;
  --color-success-bg: #163b28;
  --color-warning-text: #f0c14b;
  --color-warning-bg: #3a2f10;
  --color-warning-border: #6b5420;
  --color-info-bg: #1e2540;
  --color-info-border: #39407a;
  --color-primary-muted: #3a4470;
  --color-danger-border: #5a2530;
  --color-danger-border-strong: #7a3540;
  --color-mark-bg: #6b5b1a;
  --color-tcode-hover-bg: #2c3a6b;
  --color-diff-add-bg: #113322;
  --color-diff-del-bg: #3a1520;
  /* 사이드바는 원래도 항상 어두웠으므로 다크 모드에서 그대로 둔다. */
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
}
a {
  color: var(--color-primary);
}
button {
  font-family: inherit;
  cursor: pointer;
}
input,
textarea,
select {
  font-family: inherit;
  font-size: 14px;
}
</style>
