<script setup lang="ts">
import { ref, onMounted } from "vue";
import LoginView from "./views/LoginView.vue";
import ProjectSelector from "./views/ProjectSelector.vue";
import DashboardView from "./views/DashboardView.vue";
import { auth3, type Project } from "./api3";

// 로그인 세션은 이 브라우저에만 남는 로컬 저장소(localStorage)에 둔다 -
// docs3 CLI의 ~/.claude-native-workflow/credentials.json(SP-00002 2절)과
// 같은 역할이지만 브라우저 환경이라 저장 위치만 다르다.
const STORAGE_KEY = "tier3-dashboard-session";

const accessToken = ref<string | null>(null);
const refreshToken = ref<string | null>(null);
const project = ref<Project | null>(null);

function persist() {
  if (accessToken.value && refreshToken.value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token: accessToken.value, refresh_token: refreshToken.value }));
  }
}

function onLoggedIn(tokens: { access_token: string; refresh_token: string }) {
  accessToken.value = tokens.access_token;
  refreshToken.value = tokens.refresh_token;
  persist();
}

async function logout() {
  if (refreshToken.value) {
    await auth3.logout(refreshToken.value).catch(() => undefined);
  }
  accessToken.value = null;
  refreshToken.value = null;
  project.value = null;
  localStorage.removeItem(STORAGE_KEY);
}

function selectProject(p: Project) {
  project.value = p;
}

function switchProject() {
  project.value = null;
}

onMounted(() => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const stored = JSON.parse(raw) as { access_token: string; refresh_token: string };
    accessToken.value = stored.access_token;
    refreshToken.value = stored.refresh_token;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
});
</script>

<template>
  <LoginView v-if="!accessToken" @logged-in="onLoggedIn" />
  <template v-else>
    <DashboardView v-if="project" :token="accessToken" :project="project" @switch-project="switchProject" />
    <div v-else>
      <div class="row justify-end q-pa-sm">
        <q-btn flat dense icon="logout" label="로그아웃" @click="logout" />
      </div>
      <ProjectSelector :token="accessToken" @select="selectProject" />
    </div>
  </template>
</template>
