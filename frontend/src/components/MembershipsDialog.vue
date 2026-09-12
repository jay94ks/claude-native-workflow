<script setup lang="ts">
import { ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useMembershipsDialogStore } from "../stores/membershipsDialog";
import { nextDialogZIndex } from "../dialogZIndex";

interface UserProjectMembership {
  projectId: string;
  projectName: string;
  role: string;
  isSoleOwner: boolean;
}
interface UserTeamMembership {
  teamId: string;
  teamName: string;
  isSoleAdmin: boolean;
}
interface UserProjectGroupMembership {
  groupId: string;
  groupName: string;
  teamId: string | null;
  isSoleAdmin: boolean;
  coveredByTeamAdmin: boolean;
}
interface UserMemberships {
  projects: UserProjectMembership[];
  teams: UserTeamMembership[];
  projectGroups: UserProjectGroupMembership[];
}

const ROLE_LABEL: Record<string, string> = { owner: "owner", editor: "editor", viewer: "viewer" };

const dialog = useMembershipsDialogStore();
const memberships = ref<UserMemberships | null>(null);
const loading = ref(false);
const error = ref("");
const removingKey = ref("");
const zIndex = ref(1000);

watch(
  () => dialog.open,
  (open) => {
    if (open) zIndex.value = nextDialogZIndex();
  },
);

watch(
  () => [dialog.open, dialog.userId],
  async () => {
    if (!dialog.open || !dialog.userId) return;
    memberships.value = null;
    error.value = "";
    loading.value = true;
    try {
      memberships.value = await apiCall<UserMemberships>(`/admin/users/${dialog.userId}/memberships`);
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "소속 정보를 불러오지 못했습니다";
    } finally {
      loading.value = false;
    }
  },
);

function projectDisableReason(m: UserProjectMembership): string {
  return m.role === "owner" && m.isSoleOwner ? "이 프로젝트의 유일한 owner라 방출할 수 없습니다" : "";
}
function teamDisableReason(m: UserTeamMembership): string {
  return m.isSoleAdmin ? "이 팀의 유일한 관리자라 방출할 수 없습니다" : "";
}
function groupDisableReason(m: UserProjectGroupMembership): string {
  return m.isSoleAdmin && !m.coveredByTeamAdmin ? "이 그룹의 유일한 관리자라 방출할 수 없습니다" : "";
}

async function removeProject(m: UserProjectMembership) {
  if (!dialog.userId || !memberships.value) return;
  if (!window.confirm(`"${m.projectName}" 프로젝트에서 ${dialog.username}을(를) 방출할까요?`)) return;
  const key = `project:${m.projectId}`;
  removingKey.value = key;
  error.value = "";
  try {
    await apiCall(`/admin/users/${dialog.userId}/memberships/projects/${m.projectId}`, { method: "DELETE" });
    memberships.value.projects = memberships.value.projects.filter((p) => p.projectId !== m.projectId);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "방출에 실패했습니다";
  } finally {
    removingKey.value = "";
  }
}

async function removeTeam(m: UserTeamMembership) {
  if (!dialog.userId || !memberships.value) return;
  if (!window.confirm(`"${m.teamName}" 팀에서 ${dialog.username}을(를) 방출할까요?`)) return;
  const key = `team:${m.teamId}`;
  removingKey.value = key;
  error.value = "";
  try {
    await apiCall(`/admin/users/${dialog.userId}/memberships/teams/${m.teamId}`, { method: "DELETE" });
    memberships.value.teams = memberships.value.teams.filter((t) => t.teamId !== m.teamId);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "방출에 실패했습니다";
  } finally {
    removingKey.value = "";
  }
}

async function removeGroup(m: UserProjectGroupMembership) {
  if (!dialog.userId || !memberships.value) return;
  if (!window.confirm(`"${m.groupName}" 그룹에서 ${dialog.username}을(를) 방출할까요?`)) return;
  const key = `group:${m.groupId}`;
  removingKey.value = key;
  error.value = "";
  try {
    await apiCall(`/admin/users/${dialog.userId}/memberships/groups/${m.groupId}`, { method: "DELETE" });
    memberships.value.projectGroups = memberships.value.projectGroups.filter((g) => g.groupId !== m.groupId);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "방출에 실패했습니다";
  } finally {
    removingKey.value = "";
  }
}
</script>

<template>
  <div v-if="dialog.open" class="overlay" :style="{ zIndex }" @click.self="dialog.close()">
    <div class="dialog">
      <button class="close-btn" @click="dialog.close()">닫기 ✕</button>
      <h2>{{ dialog.username }}의 소속</h2>
      <p v-if="loading" class="muted">불러오는 중...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else-if="memberships">
        <section class="group">
          <h3>프로젝트 그룹</h3>
          <ul v-if="memberships.projectGroups.length > 0" class="list">
            <li v-for="g in memberships.projectGroups" :key="g.groupId">
              <span class="name">{{ g.groupName }}</span>
              <span class="role">관리자</span>
              <button
                class="remove-btn"
                :disabled="removingKey === `group:${g.groupId}` || !!groupDisableReason(g)"
                :title="groupDisableReason(g)"
                @click="removeGroup(g)"
              >
                강제 방출
              </button>
            </li>
          </ul>
          <p v-else class="muted">없음</p>
        </section>

        <section class="group">
          <h3>팀</h3>
          <ul v-if="memberships.teams.length > 0" class="list">
            <li v-for="t in memberships.teams" :key="t.teamId">
              <span class="name">{{ t.teamName }}</span>
              <span class="role">관리자</span>
              <button
                class="remove-btn"
                :disabled="removingKey === `team:${t.teamId}` || !!teamDisableReason(t)"
                :title="teamDisableReason(t)"
                @click="removeTeam(t)"
              >
                강제 방출
              </button>
            </li>
          </ul>
          <p v-else class="muted">없음</p>
        </section>

        <section class="group">
          <h3>프로젝트</h3>
          <ul v-if="memberships.projects.length > 0" class="list">
            <li v-for="p in memberships.projects" :key="p.projectId">
              <span class="name">{{ p.projectName }}</span>
              <span class="role">{{ ROLE_LABEL[p.role] ?? p.role }}</span>
              <button
                class="remove-btn"
                :disabled="removingKey === `project:${p.projectId}` || !!projectDisableReason(p)"
                :title="projectDisableReason(p)"
                @click="removeProject(p)"
              >
                강제 방출
              </button>
            </li>
          </ul>
          <p v-else class="muted">없음</p>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dialog {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 10px;
  padding: 24px;
  width: min(560px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
h2 {
  font-size: 16px;
  margin: 0 0 16px;
  padding-right: 80px;
}
.group {
  margin-bottom: 16px;
}
.group h3 {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 0 0 6px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 12px;
}
.list li:last-child {
  border-bottom: none;
}
.name {
  font-weight: 600;
  flex: 1;
}
.role {
  color: var(--color-text-muted);
}
.remove-btn {
  background: var(--color-surface);
  color: var(--color-danger);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.remove-btn:disabled {
  opacity: 0.5;
  color: var(--color-text-muted);
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
