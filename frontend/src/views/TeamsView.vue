<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import TeamAdminManager from "../components/TeamAdminManager.vue";
import TeamKeysManager from "../components/TeamKeysManager.vue";
import UserRef from "../components/UserRef.vue";

interface Team {
  id: string;
  name: string;
  enabled: boolean;
  isAdmin: boolean;
}
interface TeamMemberRow {
  projectId: string;
  projectName: string;
  groupId: string;
  groupName: string;
  userId: string;
  role: string;
}

const teams = ref<Team[]>([]);
const newName = ref("");
const error = ref("");
const loading = ref(true);
const expandedAdminsId = ref<string | null>(null);
const expandedKeysId = ref<string | null>(null);
const expandedMembersId = ref<string | null>(null);
const members = ref<TeamMemberRow[]>([]);
const membersError = ref("");

const editingId = ref<string | null>(null);
const editName = ref("");
const editError = ref("");
const deleteError = ref<Record<string, string>>({});

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

function startEdit(team: Team) {
  editingId.value = team.id;
  editName.value = team.name;
  editError.value = "";
}

async function saveEdit(team: Team) {
  editError.value = "";
  try {
    await apiCall(`/teams/${team.id}`, { method: "PUT", body: JSON.stringify({ name: editName.value.trim() }) });
    editingId.value = null;
    await load();
  } catch (err) {
    editError.value = err instanceof ApiError ? err.message : "수정에 실패했습니다";
  }
}

async function toggleEnabled(team: Team) {
  try {
    await apiCall(`/teams/${team.id}`, { method: "PUT", body: JSON.stringify({ enabled: !team.enabled }) });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "수정에 실패했습니다";
  }
}

async function remove(team: Team) {
  deleteError.value = { ...deleteError.value, [team.id]: "" };
  try {
    await apiCall(`/teams/${team.id}`, { method: "DELETE" });
    await load();
  } catch (err) {
    deleteError.value = {
      ...deleteError.value,
      [team.id]: err instanceof ApiError ? err.message : "삭제에 실패했습니다",
    };
  }
}

async function toggleMembers(id: string) {
  if (expandedMembersId.value === id) {
    expandedMembersId.value = null;
    return;
  }
  expandedMembersId.value = id;
  membersError.value = "";
  try {
    members.value = await apiCall<TeamMemberRow[]>(`/teams/${id}/members`);
  } catch (err) {
    membersError.value = err instanceof ApiError ? err.message : "멤버 목록을 불러오지 못했습니다(그 팀의 관리자만 볼 수 있습니다)";
  }
}

function toggleAdmins(id: string) {
  expandedAdminsId.value = expandedAdminsId.value === id ? null : id;
}

function toggleKeys(id: string) {
  expandedKeysId.value = expandedKeysId.value === id ? null : id;
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
        <template v-if="editingId === team.id">
          <input v-model="editName" type="text" class="edit-input" />
          <button class="manage-btn" @click="saveEdit(team)">저장</button>
          <button class="manage-btn" @click="editingId = null">취소</button>
        </template>
        <template v-else>
          <span>{{ team.name }}</span>
          <span class="muted">{{ team.enabled ? "" : "(비활성)" }}</span>
          <template v-if="team.isAdmin">
            <button class="manage-btn" @click="startEdit(team)">이름 수정</button>
            <button class="manage-btn" @click="toggleEnabled(team)">{{ team.enabled ? "비활성화" : "활성화" }}</button>
          </template>
        </template>
        <template v-if="team.isAdmin">
          <button class="manage-btn" @click="toggleMembers(team.id)">
            {{ expandedMembersId === team.id ? "멤버 닫기" : "멤버 보기" }}
          </button>
          <button class="manage-btn" @click="toggleAdmins(team.id)">
            {{ expandedAdminsId === team.id ? "팀장 관리 닫기" : "팀장 관리" }}
          </button>
          <button class="manage-btn" @click="toggleKeys(team.id)">
            {{ expandedKeysId === team.id ? "키 관리 닫기" : "키 관리" }}
          </button>
          <button class="danger-btn" @click="remove(team)">삭제</button>
        </template>
      </div>
      <p v-if="editError && editingId === team.id" class="error inline">{{ editError }}</p>
      <p v-if="deleteError[team.id]" class="error inline">{{ deleteError[team.id] }}</p>

      <div v-if="expandedMembersId === team.id" class="manage-panel">
        <p class="hint">이 팀 산하 모든 프로젝트 그룹·프로젝트의 멤버 - 팀 관리자만 볼 수 있다.</p>
        <p v-if="membersError" class="error">{{ membersError }}</p>
        <ul class="member-list">
          <li v-for="(m, i) in members" :key="i">
            <UserRef :user-id="m.userId" />
            <span class="muted">{{ m.role }}</span>
            <span class="muted">{{ m.groupName }} / {{ m.projectName }}</span>
          </li>
          <li v-if="!membersError && members.length === 0" class="muted">멤버가 없습니다.</li>
        </ul>
      </div>
      <div v-if="expandedAdminsId === team.id" class="manage-panel">
        <TeamAdminManager :team-id="team.id" />
      </div>
      <div v-if="expandedKeysId === team.id" class="manage-panel">
        <TeamKeysManager :team-id="team.id" />
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
  flex-wrap: wrap;
}
.edit-input {
  padding: 5px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
}
.manage-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.manage-btn:hover {
  background: #eef0f6;
}
.danger-btn {
  margin-left: auto;
  background: #fff;
  border: 1px solid #e2a2ad;
  color: #d1344b;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.manage-panel {
  padding: 0 16px 16px;
}
.member-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.member-list li {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #eee;
  font-size: 13px;
}
.member-list li:last-child {
  border-bottom: none;
}
.hint {
  font-size: 12px;
  color: #999;
  margin: 0 0 8px;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
.error.inline {
  padding: 0 16px 8px;
  margin: 0;
}
</style>
