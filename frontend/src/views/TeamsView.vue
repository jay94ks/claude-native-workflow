<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import DocTypeManager from "../components/DocTypeManager.vue";
import TeamAdminManager from "../components/TeamAdminManager.vue";

interface Team {
  id: string;
  name: string;
  enabled: boolean;
}

const teams = ref<Team[]>([]);
const newName = ref("");
const error = ref("");
const loading = ref(true);
const expandedId = ref<string | null>(null);
const expandedAdminsId = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    teams.value = await apiCall<Team[]>("/teams");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function create() {
  if (!newName.value.trim()) return;
  error.value = "";
  try {
    await apiCall("/teams", { method: "POST", body: JSON.stringify({ name: newName.value.trim() }) });
    newName.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

function toggleManage(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

function toggleAdmins(id: string) {
  expandedAdminsId.value = expandedAdminsId.value === id ? null : id;
}

onMounted(load);
</script>

<template>
  <h1>팀</h1>
  <form class="create-row" @submit.prevent="create">
    <input v-model="newName" type="text" placeholder="새 팀 이름" />
    <button type="submit">추가</button>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="team in teams" :key="team.id">
      <div class="row">
        <span>{{ team.name }}</span>
        <span class="muted">{{ team.enabled ? "" : "(비활성)" }}</span>
        <button class="manage-btn" @click="toggleManage(team.id)">
          {{ expandedId === team.id ? "문서 타입 관리 닫기" : "문서 타입 관리" }}
        </button>
        <button class="manage-btn" @click="toggleAdmins(team.id)">
          {{ expandedAdminsId === team.id ? "팀장 관리 닫기" : "팀장 관리" }}
        </button>
      </div>
      <div v-if="expandedId === team.id" class="manage-panel">
        <DocTypeManager scope="team" :scope-id="team.id" />
      </div>
      <div v-if="expandedAdminsId === team.id" class="manage-panel">
        <TeamAdminManager :team-id="team.id" />
      </div>
    </li>
    <li v-if="teams.length === 0" class="muted">아직 팀이 없습니다.</li>
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
