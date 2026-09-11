<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ id: string }>();

interface Project {
  id: string;
  name: string;
  projectGroupId: string;
}

const project = ref<Project | null>(null);
const loading = ref(true);
const error = ref("");

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
      <router-link :to="`/projects/${id}/changes`">변경 추적</router-link>
      <router-link :to="`/projects/${id}/kanban`">칸반 보드</router-link>
      <router-link :to="`/projects/${id}/settings`">설정</router-link>
      <router-link :to="`/projects/${id}/keys`">키 관리</router-link>
    </nav>

    <router-view />
  </template>
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 16px;
}
.tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
}
.tabs a {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  text-decoration: none;
  color: #1a1a2e;
}
.tabs a:hover {
  background: #eef0f6;
}
.tabs a.router-link-exact-active {
  background: #3454d1;
  border-color: #3454d1;
  color: #fff;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
