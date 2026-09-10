<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import DocTypeManager from "../components/DocTypeManager.vue";

interface ProjectGroup {
  id: string;
  teamId: string | null;
  name: string;
}
interface Team {
  id: string;
  name: string;
}

const groups = ref<ProjectGroup[]>([]);
const teams = ref<Team[]>([]);
const newName = ref("");
const newTeamId = ref("");
const error = ref("");
const loading = ref(true);
const expandedId = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    const [groupList, teamList] = await Promise.all([
      apiCall<ProjectGroup[]>("/project-groups"),
      apiCall<Team[]>("/teams").catch(() => []),
    ]);
    groups.value = groupList;
    teams.value = teamList;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function teamName(id: string | null): string {
  if (!id) return "-";
  return teams.value.find((t) => t.id === id)?.name ?? id;
}

async function create() {
  if (!newName.value.trim()) return;
  error.value = "";
  try {
    await apiCall("/project-groups", {
      method: "POST",
      body: JSON.stringify({ name: newName.value.trim(), teamId: newTeamId.value || undefined }),
    });
    newName.value = "";
    newTeamId.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

function toggleManage(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

onMounted(load);
</script>

<template>
  <h1>프로젝트 그룹</h1>
  <form class="create-row" @submit.prevent="create">
    <input v-model="newName" type="text" placeholder="새 그룹 이름" />
    <select v-if="teams.length > 0" v-model="newTeamId">
      <option value="">팀 없음</option>
      <option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option>
    </select>
    <button type="submit">추가</button>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="group in groups" :key="group.id">
      <div class="row">
        <span>{{ group.name }}</span>
        <span class="muted">{{ teamName(group.teamId) }}</span>
        <button class="manage-btn" @click="toggleManage(group.id)">
          {{ expandedId === group.id ? "문서 타입 관리 닫기" : "문서 타입 관리" }}
        </button>
      </div>
      <div v-if="expandedId === group.id" class="manage-panel">
        <DocTypeManager scope="group" :scope-id="group.id" />
      </div>
    </li>
    <li v-if="groups.length === 0" class="muted">아직 프로젝트 그룹이 없습니다.</li>
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
  border-bottom: 1px solid #eee;
}
.list li:last-child {
  border-bottom: none;
}
.row {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.manage-btn {
  margin-left: auto;
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.manage-btn:hover {
  background: #eef0f6;
}
.manage-panel {
  padding: 0 16px 16px;
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
