<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useThemeStore } from "../stores/theme";
import { apiCall } from "../api/client";
import DocumentExplorer from "./DocumentExplorer.vue";
import DocumentPreviewDialog from "./DocumentPreviewDialog.vue";
import KanbanCardDialog from "./KanbanCardDialog.vue";
import EntityPickerDialog from "./EntityPickerDialog.vue";
import FolderPickerDialog from "./FolderPickerDialog.vue";
import SidebarSearchBox from "./SidebarSearchBox.vue";
import SearchScopeDialog from "./SearchScopeDialog.vue";
import TargetPanelDialog from "./TargetPanelDialog.vue";
import MembershipsDialog from "./MembershipsDialog.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const theme = useThemeStore();
const teamsEnabled = ref(true);

// 모바일 폭(≤768px)에서만 의미가 있는 사이드바 열림/닫힘 상태 - 데스크톱
// CSS는 이 클래스를 무시하고 사이드바를 항상 보여준다.
const sidebarOpen = ref(false);

const activeProjectId = computed(() =>
  route.meta.projectContext && typeof route.params.id === "string" ? route.params.id : null,
);

const themeModeLabel = computed(() => ({ light: "라이트", dark: "다크", system: "시스템" })[theme.mode]);

onMounted(async () => {
  try {
    const config = await apiCall<{ teamsEnabled: boolean }>("/install-config");
    teamsEnabled.value = config.teamsEnabled;
  } catch {
    // 조회 실패해도 기본값(true)으로 둔다 - 네비게이션이 아예 안 보이는
    // 것보다 안전한 쪽으로.
  }
  if (!auth.me) await auth.loadMe();
});

// 모바일에서 링크를 눌러 페이지가 바뀌면 사이드바를 자동으로 닫는다 -
// 안 그러면 다음 화면 위에 그대로 덮여 있어 매번 손으로 닫아야 함.
watch(() => route.fullPath, () => { sidebarOpen.value = false; });

function handleLogout() {
  auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="layout">
    <button class="menu-toggle" @click="sidebarOpen = !sidebarOpen" aria-label="메뉴">☰</button>
    <div v-if="sidebarOpen" class="backdrop" @click="sidebarOpen = false"></div>
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="brand">claude-native-workflow</div>
      <template v-if="activeProjectId">
        <router-link to="/projects" class="back-link">← 전체 프로젝트</router-link>
        <SidebarSearchBox :project-id="activeProjectId" />
        <DocumentExplorer :project-id="activeProjectId" />
      </template>
      <nav v-else>
        <router-link v-if="teamsEnabled" to="/teams">팀</router-link>
        <router-link to="/groups">프로젝트 그룹</router-link>
        <router-link to="/projects">프로젝트</router-link>
        <router-link v-if="auth.me?.isSuperAdmin" to="/admin/users">사용자 관리</router-link>
      </nav>
      <router-link v-if="auth.me" :to="`/users/${auth.me.id}`" class="me-link">내 정보</router-link>
      <button class="theme-toggle" @click="theme.cycle()" :title="`테마: ${themeModeLabel} (클릭해서 전환)`">
        {{ theme.mode === "dark" ? "🌙" : theme.mode === "light" ? "☀️" : "🖥️" }} {{ themeModeLabel }}
      </button>
      <button class="logout" @click="handleLogout">로그아웃</button>
    </aside>
    <main class="content">
      <slot />
    </main>
    <DocumentPreviewDialog />
    <MembershipsDialog />
    <KanbanCardDialog />
    <EntityPickerDialog />
    <FolderPickerDialog />
    <SearchScopeDialog />
    <TargetPanelDialog />
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
}
.menu-toggle {
  display: none;
}
.backdrop {
  display: none;
}
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--color-sidebar-bg);
  color: var(--color-sidebar-text);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
}
.brand {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 24px;
  line-height: 1.3;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
nav a {
  color: var(--color-sidebar-muted);
  text-decoration: none;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 14px;
}
nav a:hover,
nav a.router-link-active {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text);
}
.back-link {
  display: block;
  color: var(--color-sidebar-muted);
  text-decoration: none;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}
.back-link:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text);
}
.me-link {
  display: block;
  color: var(--color-sidebar-muted);
  text-decoration: none;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 8px;
}
.me-link:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text);
}
.theme-toggle {
  background: none;
  border: 1px solid var(--color-sidebar-border);
  color: var(--color-sidebar-muted);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 8px;
  text-align: left;
}
.theme-toggle:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text);
}
.logout {
  background: none;
  border: 1px solid var(--color-sidebar-border);
  color: var(--color-sidebar-muted);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.logout:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text);
}
.content {
  flex: 1;
  padding: 32px 40px;
  max-width: 960px;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

@media (max-width: 768px) {
  .menu-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 50;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 6px;
    background: var(--color-sidebar-bg);
    color: var(--color-sidebar-text);
    font-size: 16px;
  }
  .backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 40;
  }
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 45;
    width: 240px;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    overflow-y: auto;
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .content {
    max-width: 100%;
    padding: 56px 16px 16px;
  }
}
</style>
