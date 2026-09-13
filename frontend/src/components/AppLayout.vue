<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useThemeStore } from "../stores/theme";
import { useQuestionDialogStore } from "../stores/questionDialog";
import { apiCall, ApiError } from "../api/client";
import DocumentExplorer from "./DocumentExplorer.vue";
import DocumentPreviewDialog from "./DocumentPreviewDialog.vue";
import KanbanCardDialog from "./KanbanCardDialog.vue";
import QuestionDialog from "./QuestionDialog.vue";
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
const questionDialog = useQuestionDialogStore();
const teamsEnabled = ref(true);

// 모바일 폭(≤768px)에서만 의미가 있는 사이드바 열림/닫힘 상태 - 데스크톱
// CSS는 이 클래스를 무시하고 사이드바를 항상 보여준다.
const sidebarOpen = ref(false);

const activeProjectId = computed(() =>
  route.meta.projectContext && typeof route.params.id === "string" ? route.params.id : null,
);

const themeModeLabel = computed(() => ({ light: "라이트", dark: "다크", system: "시스템" })[theme.mode]);

// 관계도/칸반 보드처럼 960px 폭이 답답한 화면은 route meta로 표시해
// 이 레이아웃의 기본 폭 제한을 풀어준다(#relations-kanban-full-width) -
// 화면을 넘기지는 않는다(max-width: 100%일 뿐, 그 이상은 각 화면 자체의
// 내부 스크롤로 처리).
const isFullWidth = computed(() => route.meta.fullWidth === true);

// ---------------------------------------------------------------- 알림 종(#notification-bell)
// "내 정보" 왼쪽 - 내가 속한 모든 프로젝트를 통틀어 "답변 대기"(open+
// pending) 질의를 배지 숫자로 보여주고, 누르면 목록이 드롭다운으로
// 뜬다. 항목을 누르면 기존 QuestionDialog(#reserved-tracking-codes)를
// 그대로 연다 - 답변은 거기서 "대상 열기"로 넘어가서.

interface BellQuestion {
  trackingCode: string;
  projectId: string;
  projectName: string;
  targetLabel: string;
  kind: string;
  text: string;
  status: string;
}
interface BellPage {
  items: BellQuestion[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const BELL_KIND_LABEL: Record<string, string> = { answer: "답변 요청", approval: "승인 요청" };
const bellOpen = ref(false);
const bellCount = ref(0);
const bellItems = ref<BellQuestion[]>([]);
const bellLoading = ref(false);
const bellError = ref("");
const bellCountLabel = computed(() => (bellCount.value > 99 ? "99+" : String(bellCount.value)));
let bellPollTimer: ReturnType<typeof setInterval> | null = null;

async function loadBellCount() {
  try {
    const result = await apiCall<{ count: number }>("/auth/me/pending-questions/count");
    bellCount.value = result.count;
  } catch {
    // 배지는 부수 정보라 조회 실패해도 조용히 무시(이전 값 유지).
  }
}

async function loadBellItems() {
  bellLoading.value = true;
  bellError.value = "";
  try {
    const result = await apiCall<BellPage>("/auth/me/pending-questions/page?page=1&pageSize=20");
    bellItems.value = result.items;
  } catch (err) {
    bellError.value = err instanceof ApiError ? err.message : "알림을 불러오지 못했습니다";
  } finally {
    bellLoading.value = false;
  }
}

function toggleBell() {
  bellOpen.value = !bellOpen.value;
  if (bellOpen.value) loadBellItems();
}

function openBellItem(q: BellQuestion) {
  bellOpen.value = false;
  questionDialog.show(q.trackingCode);
}

onMounted(async () => {
  try {
    const config = await apiCall<{ teamsEnabled: boolean }>("/install-config");
    teamsEnabled.value = config.teamsEnabled;
  } catch {
    // 조회 실패해도 기본값(true)으로 둔다 - 네비게이션이 아예 안 보이는
    // 것보다 안전한 쪽으로.
  }
  if (!auth.me) await auth.loadMe();
  if (auth.me) {
    await loadBellCount();
    bellPollTimer = setInterval(loadBellCount, 60_000);
  }
});

onUnmounted(() => {
  if (bellPollTimer) clearInterval(bellPollTimer);
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
      <div v-if="auth.me" class="me-row">
        <div class="bell-wrap">
          <button type="button" class="bell-btn" :title="`미확인 알림 ${bellCount}건`" @click="toggleBell">
            🔔
            <span v-if="bellCount > 0" class="bell-badge">{{ bellCountLabel }}</span>
          </button>
          <div v-if="bellOpen" class="bell-backdrop" @click="bellOpen = false"></div>
          <div v-if="bellOpen" class="bell-panel">
            <h3>미확인 알림</h3>
            <div class="bell-body">
              <p v-if="bellLoading" class="muted">불러오는 중...</p>
              <p v-else-if="bellError" class="error">{{ bellError }}</p>
              <ul v-else class="bell-list">
                <li v-for="q in bellItems" :key="q.trackingCode" @click="openBellItem(q)">
                  <div class="bell-item-top">
                    <span class="bell-kind">{{ BELL_KIND_LABEL[q.kind] ?? q.kind }}</span>
                    <span class="bell-project">{{ q.projectName }}</span>
                  </div>
                  <div class="bell-item-text">{{ q.text }}</div>
                  <div class="bell-item-target">{{ q.targetLabel }}</div>
                </li>
                <li v-if="bellItems.length === 0" class="muted empty">미확인 알림이 없습니다.</li>
              </ul>
            </div>
            <router-link to="/notifications" class="bell-more" @click="bellOpen = false">더보기</router-link>
          </div>
        </div>
        <router-link :to="`/users/${auth.me.id}`" class="me-link">내 정보</router-link>
      </div>
      <button class="theme-toggle" @click="theme.cycle()" :title="`테마: ${themeModeLabel} (클릭해서 전환)`">
        {{ theme.mode === "dark" ? "🌙" : theme.mode === "light" ? "☀️" : "🖥️" }} {{ themeModeLabel }}
      </button>
      <button class="logout" @click="handleLogout">로그아웃</button>
    </aside>
    <main class="content" :class="{ 'full-width': isFullWidth }">
      <slot />
    </main>
    <DocumentPreviewDialog />
    <MembershipsDialog />
    <KanbanCardDialog />
    <QuestionDialog />
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
  width: 300px;
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
.me-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.me-link {
  display: block;
  flex: 1;
  min-width: 0;
  color: var(--color-sidebar-muted);
  text-decoration: none;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.me-link:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text);
}
.bell-wrap {
  position: relative;
  flex-shrink: 0;
}
.bell-btn {
  position: relative;
  background: none;
  border: 1px solid var(--color-sidebar-border);
  color: var(--color-sidebar-muted);
  width: 34px;
  height: 34px;
  border-radius: 6px;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bell-btn:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-sidebar-text);
}
.bell-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  background: var(--color-danger);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  padding: 3px 4px;
  border-radius: 999px;
  min-width: 14px;
  text-align: center;
}
.bell-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.bell-panel {
  position: absolute;
  bottom: 0;
  left: calc(100% + 8px);
  z-index: 61;
  width: 320px;
  max-height: 400px;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}
.bell-panel h3 {
  font-size: 13px;
  margin: 0 0 8px;
  flex-shrink: 0;
}
.bell-body {
  overflow-y: auto;
  min-height: 0;
}
.bell-more {
  display: block;
  flex-shrink: 0;
  text-align: center;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-light);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
  text-decoration: none;
}
.bell-more:hover {
  text-decoration: underline;
}
.bell-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bell-list li {
  cursor: pointer;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-light);
}
.bell-list li:hover {
  border-color: var(--color-primary);
}
.bell-list .empty {
  cursor: default;
  background: none;
  border: none;
  padding: 4px 2px;
}
.bell-item-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.bell-kind {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--color-purple-bg);
  color: var(--color-purple-text);
  flex-shrink: 0;
}
.bell-project {
  font-size: 11px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bell-item-text {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bell-item-target {
  font-size: 11px;
  color: var(--color-text-faint);
  margin-top: 2px;
}
.bell-panel .muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.bell-panel .error {
  color: var(--color-danger);
  font-size: 13px;
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
.content.full-width {
  max-width: 100%;
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
