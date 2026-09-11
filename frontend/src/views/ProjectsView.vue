<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

interface Project {
  id: string;
  projectGroupId: string;
  name: string;
  hidden: boolean;
  canToggleHidden: boolean;
}
interface ProjectGroup {
  id: string;
  name: string;
}

const projects = ref<Project[]>([]);
const groups = ref<ProjectGroup[]>([]);
const newName = ref("");
const newGroupId = ref("");
const error = ref("");
const loading = ref(true);
const hideError = ref("");

async function load() {
  loading.value = true;
  try {
    const [projectList, groupList] = await Promise.all([
      apiCall<Project[]>("/projects"),
      apiCall<ProjectGroup[]>("/project-groups").catch(() => []),
    ]);
    projects.value = projectList;
    groups.value = groupList;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function groupName(id: string): string {
  return groups.value.find((g) => g.id === id)?.name ?? id;
}

async function create() {
  if (!newName.value.trim()) return;
  error.value = "";
  try {
    await apiCall("/projects", {
      method: "POST",
      body: JSON.stringify({ name: newName.value.trim(), projectGroupId: newGroupId.value || undefined }),
    });
    newName.value = "";
    newGroupId.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

async function toggleHidden(project: Project) {
  hideError.value = "";
  try {
    await apiCall(`/projects/${project.id}/hidden`, {
      method: "PUT",
      body: JSON.stringify({ hidden: !project.hidden }),
    });
    await load();
  } catch (err) {
    hideError.value = err instanceof ApiError ? err.message : "숨김 상태를 바꾸지 못했습니다(owner 또는 팀장만 가능)";
  }
}

onMounted(load);
</script>

<template>
  <h1>프로젝트</h1>
  <form class="create-row" @submit.prevent="create">
    <input v-model="newName" type="text" placeholder="새 프로젝트 이름" />
    <select v-if="groups.length > 0" v-model="newGroupId">
      <option value="">기본 그룹</option>
      <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
    </select>
    <button type="submit">추가</button>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="hideError" class="error">{{ hideError }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="project in projects" :key="project.id">
      <span class="left">
        <router-link :to="`/projects/${project.id}`">{{ project.name }}</router-link>
        <span v-if="project.hidden" class="hidden-badge">🔒 숨김</span>
        <span class="muted">{{ groupName(project.projectGroupId) }}</span>
      </span>
      <button v-if="project.canToggleHidden" class="hide-btn" @click="toggleHidden(project)">{{ project.hidden ? "숨김 해제" : "숨김" }}</button>
    </li>
    <li v-if="projects.length === 0" class="muted">아직 프로젝트가 없습니다.</li>
  </ul>
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 16px;
}
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.create-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.create-row select {
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.create-row button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.list {
  list-style: none;
  padding: 0;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
}
.list li:last-child {
  border-bottom: none;
}
.left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hidden-badge {
  font-size: 11px;
  background: #fbeee0;
  color: #8a5a1a;
  padding: 2px 8px;
  border-radius: 999px;
}
.hide-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
