<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { apiCall } from "../api/client";
import DocumentExplorer from "./DocumentExplorer.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const teamsEnabled = ref(true);

const activeProjectId = computed(() => (typeof route.params.id === "string" ? route.params.id : null));

onMounted(async () => {
  try {
    const config = await apiCall<{ teamsEnabled: boolean }>("/install-config");
    teamsEnabled.value = config.teamsEnabled;
  } catch {
    // 조회 실패해도 기본값(true)으로 둔다 - 네비게이션이 아예 안 보이는
    // 것보다 안전한 쪽으로.
  }
});

function handleLogout() {
  auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">claude-native-workflow</div>
      <template v-if="activeProjectId">
        <router-link to="/projects" class="back-link">← 전체 프로젝트</router-link>
        <DocumentExplorer :project-id="activeProjectId" />
      </template>
      <nav v-else>
        <router-link v-if="teamsEnabled" to="/teams">팀</router-link>
        <router-link to="/groups">프로젝트 그룹</router-link>
        <router-link to="/projects">프로젝트</router-link>
      </nav>
      <button class="logout" @click="handleLogout">로그아웃</button>
    </aside>
    <main class="content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: #1a1a2e;
  color: #fff;
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
  color: #c7c9e8;
  text-decoration: none;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 14px;
}
nav a:hover,
nav a.router-link-active {
  background: #2e2f4d;
  color: #fff;
}
.back-link {
  display: block;
  color: #c7c9e8;
  text-decoration: none;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}
.back-link:hover {
  background: #2e2f4d;
  color: #fff;
}
.logout {
  background: none;
  border: 1px solid #454668;
  color: #c7c9e8;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.logout:hover {
  background: #2e2f4d;
  color: #fff;
}
.content {
  flex: 1;
  padding: 32px 40px;
  max-width: 960px;
}
</style>
