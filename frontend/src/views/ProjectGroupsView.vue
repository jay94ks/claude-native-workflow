<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import GroupAdminManager from "../components/GroupAdminManager.vue";
import UserRef from "../components/UserRef.vue";

interface ProjectGroup {
  id: string;
  teamId: string | null;
  name: string;
  isPublic: boolean;
  isAdmin: boolean;
}
interface Team {
  id: string;
  name: string;
}
interface GroupMemberRow {
  projectId: string;
  projectName: string;
  userId: string;
  role: string;
}

const groups = ref<ProjectGroup[]>([]);
const teams = ref<Team[]>([]);
const newName = ref("");
const newTeamId = ref("");
const newIsPublic = ref(false);
const error = ref("");
const loading = ref(true);
const expandedAdminsId = ref<string | null>(null);
const expandedMembersId = ref<string | null>(null);
const members = ref<GroupMemberRow[]>([]);
const membersError = ref("");

const editingId = ref<string | null>(null);
const editName = ref("");
const editError = ref("");
const deleteError = ref<Record<string, string>>({});
const moveError = ref<Record<string, string>>({});

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
      body: JSON.stringify({ name: newName.value.trim(), teamId: newTeamId.value || undefined, isPublic: newIsPublic.value }),
    });
    newName.value = "";
    newTeamId.value = "";
    newIsPublic.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

async function togglePublic(group: ProjectGroup) {
  try {
    await apiCall(`/project-groups/${group.id}`, { method: "PUT", body: JSON.stringify({ isPublic: !group.isPublic }) });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "수정에 실패했습니다";
  }
}

function startEdit(group: ProjectGroup) {
  editingId.value = group.id;
  editName.value = group.name;
  editError.value = "";
}

async function saveEdit(group: ProjectGroup) {
  editError.value = "";
  try {
    await apiCall(`/project-groups/${group.id}`, { method: "PUT", body: JSON.stringify({ name: editName.value.trim() }) });
    editingId.value = null;
    await load();
  } catch (err) {
    editError.value = err instanceof ApiError ? err.message : "수정에 실패했습니다";
  }
}

async function moveTeam(group: ProjectGroup, teamId: string) {
  moveError.value = { ...moveError.value, [group.id]: "" };
  try {
    await apiCall(`/project-groups/${group.id}`, { method: "PUT", body: JSON.stringify({ teamId: teamId || null }) });
    await load();
  } catch (err) {
    moveError.value = {
      ...moveError.value,
      [group.id]: err instanceof ApiError ? err.message : "재소속에 실패했습니다",
    };
  }
}

async function remove(group: ProjectGroup) {
  deleteError.value = { ...deleteError.value, [group.id]: "" };
  try {
    await apiCall(`/project-groups/${group.id}`, { method: "DELETE" });
    await load();
  } catch (err) {
    deleteError.value = {
      ...deleteError.value,
      [group.id]: err instanceof ApiError ? err.message : "삭제에 실패했습니다",
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
    members.value = await apiCall<GroupMemberRow[]>(`/project-groups/${id}/members`);
  } catch (err) {
    membersError.value = err instanceof ApiError ? err.message : "멤버 목록을 불러오지 못했습니다(그 그룹의 관리자만 볼 수 있습니다)";
  }
}

function toggleAdmins(id: string) {
  expandedAdminsId.value = expandedAdminsId.value === id ? null : id;
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
    <label class="public-check"><input v-model="newIsPublic" type="checkbox" /> 공개</label>
    <button type="submit">추가</button>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="group in groups" :key="group.id">
      <div class="row">
        <template v-if="editingId === group.id">
          <input v-model="editName" type="text" class="edit-input" />
          <button class="manage-btn" @click="saveEdit(group)">저장</button>
          <button class="manage-btn" @click="editingId = null">취소</button>
        </template>
        <template v-else>
          <span>{{ group.name }}</span>
          <select
            v-if="group.isAdmin && teams.length > 0"
            class="move-select"
            :value="group.teamId ?? ''"
            @change="moveTeam(group, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">팀 없음</option>
            <option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option>
          </select>
          <span v-else class="muted">{{ teamName(group.teamId) }}</span>
          <span class="public-badge" :class="{ on: group.isPublic }">{{ group.isPublic ? "공개" : "비공개" }}</span>
          <button v-if="group.isAdmin" class="manage-btn" @click="startEdit(group)">이름 수정</button>
        </template>
        <template v-if="group.isAdmin">
          <button class="manage-btn" @click="togglePublic(group)">{{ group.isPublic ? "비공개로 전환" : "공개로 전환" }}</button>
          <button class="manage-btn" @click="toggleMembers(group.id)">
            {{ expandedMembersId === group.id ? "멤버 닫기" : "멤버 보기" }}
          </button>
          <button class="manage-btn" @click="toggleAdmins(group.id)">
            {{ expandedAdminsId === group.id ? "그룹 관리자 닫기" : "그룹 관리자" }}
          </button>
          <button class="danger-btn" @click="remove(group)">삭제</button>
        </template>
      </div>
      <p v-if="editError && editingId === group.id" class="error inline">{{ editError }}</p>
      <p v-if="deleteError[group.id]" class="error inline">{{ deleteError[group.id] }}</p>
      <p v-if="moveError[group.id]" class="error inline">{{ moveError[group.id] }}</p>

      <div v-if="expandedMembersId === group.id" class="manage-panel">
        <p class="hint">이 그룹 산하 모든 프로젝트의 멤버 - 그룹 관리자만 볼 수 있다.</p>
        <p v-if="membersError" class="error">{{ membersError }}</p>
        <ul class="member-list">
          <li v-for="(m, i) in members" :key="i">
            <UserRef :user-id="m.userId" />
            <span class="muted">{{ m.role }}</span>
            <span class="muted">{{ m.projectName }}</span>
          </li>
          <li v-if="!membersError && members.length === 0" class="muted">멤버가 없습니다.</li>
        </ul>
      </div>
      <div v-if="expandedAdminsId === group.id" class="manage-panel">
        <GroupAdminManager :group-id="group.id" />
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
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.create-row select {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.create-row button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.public-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.public-check input {
  flex: none;
  width: auto;
  padding: 0;
  border: none;
}
.public-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-surface-hover);
  color: var(--color-text-muted);
}
.public-badge.on {
  background: var(--color-success-bg);
  color: var(--color-success);
}
.list {
  list-style: none;
  padding: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  border-bottom: 1px solid var(--color-border-light);
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
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.move-select {
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
}
.manage-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.manage-btn:hover {
  background: var(--color-surface-hover);
}
.danger-btn {
  margin-left: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-danger-border-strong);
  color: var(--color-danger);
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
  border-bottom: 1px solid var(--color-border-light);
  font-size: 13px;
}
.member-list li:last-child {
  border-bottom: none;
}
.hint {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 0 0 8px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
.error.inline {
  padding: 0 16px 8px;
  margin: 0;
}
</style>
