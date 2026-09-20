<template>
  <div v-if="ui.sidebarOpen" class="project-sidebar-backdrop" @click="ui.closeSidebar()" />
  <aside class="project-sidebar" :class="{ 'project-sidebar--open': ui.sidebarOpen }">
    <slot />
  </aside>
</template>

<script setup lang="ts">
// 설계자 요청(2026-09-21) - Code/Pull requests/Issues/Documents/Trackers/
// Settings 좌측 패널을 전부 270px 고정폭으로 통일하는 공용 래퍼. 좁은
// 화면(1024px 미만)에서는 위치를 고정 오프캔버스로 바꾸고 로고 좌측
// 햄버거(MainLayout.vue)로 토글한다 - 토글 상태는 stores/ui.ts(전역)에
// 있다. 라우트가 바뀌면(사이드바 안의 항목을 눌러 이동한 경우 등)
// 모바일에서는 자동으로 닫아준다.
import { watch } from "vue";
import { useRoute } from "vue-router";
import { useUiStore } from "stores/ui";

const ui = useUiStore();
const route = useRoute();

watch(
  () => route.fullPath,
  () => ui.closeSidebar()
);
</script>

<style scoped>
.project-sidebar {
  width: 270px;
  min-width: 270px;
  max-width: 270px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 8px;
}
.project-sidebar-backdrop {
  display: none;
}
@media (max-width: 1023px) {
  .project-sidebar {
    position: fixed;
    top: 62px;
    left: 0;
    bottom: 0;
    z-index: 2000;
    background: var(--gh-canvas);
    border-right: 1px solid var(--gh-border);
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.15);
  }
  .project-sidebar--open {
    transform: translateX(0);
  }
  .project-sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    top: 62px;
    background: rgba(0, 0, 0, 0.4);
    z-index: 1999;
  }
}
</style>
