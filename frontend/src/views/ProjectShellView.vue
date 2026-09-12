<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY } from "../utils/projectContext";

const props = defineProps<{ id: string }>();

interface Project {
  id: string;
  name: string;
  projectGroupId: string;
  myRole: string | null;
}

const project = ref<Project | null>(null);
const loading = ref(true);
const error = ref("");

provide(PROJECT_MY_ROLE_KEY, computed(() => project.value?.myRole ?? null));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    project.value = await apiCall<Project>(`/projects/${props.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "프로젝트 정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.id, load);
</script>

<template>
  <p v-if="loading">불러오는 중...</p>
  <template v-else-if="project">
    <h1>{{ project.name }}</h1>
    <p v-if="error" class="error">{{ error }}</p>

    <nav class="tabs">
      <router-link :to="`/projects/${id}`">홈</router-link>
      <router-link :to="`/projects/${id}/messages`">메시지</router-link>
      <router-link :to="`/projects/${id}/documents`">문서</router-link>
      <router-link :to="`/projects/${id}/source`">소스 코드</router-link>
      <router-link :to="`/projects/${id}/repo`">저장소 관리</router-link>
      <router-link :to="`/projects/${id}/relations`">관계도</router-link>
      <router-link :to="`/projects/${id}/changes`">변경 추적</router-link>
      <router-link :to="`/projects/${id}/kanban`">칸반 보드</router-link>
      <router-link :to="`/projects/${id}/settings`">설정</router-link>
      <router-link :to="`/projects/${id}/keys`">키 관리</router-link>
    </nav>

    <div class="tab-content">
      <router-view />
    </div>
  </template>
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 16px;
  flex-shrink: 0;
}
.tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
  overflow-x: auto;
  flex-wrap: nowrap;
  padding-bottom: 2px;
  flex-shrink: 0;
}
.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.tabs a {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  text-decoration: none;
  color: var(--color-text);
  white-space: nowrap;
  flex-shrink: 0;
}
.tabs a:hover {
  background: var(--color-surface-hover);
}
.tabs a.router-link-exact-active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
