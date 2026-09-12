<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "./UserRef.vue";
import { useEntityPickerStore } from "../stores/entityPicker";

const props = defineProps<{ groupId: string }>();
const entityPicker = useEntityPickerStore();

interface ProjectGroupAdmin {
  id: string;
  userId: string;
}

const admins = ref<ProjectGroupAdmin[]>([]);
const loading = ref(true);
const error = ref("");
const newUserId = ref("");
const addError = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    admins.value = await apiCall<ProjectGroupAdmin[]>(`/project-groups/${props.groupId}/admins`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "그룹 관리자 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function pickNewUser() {
  const result = await entityPicker.pick({ kind: "user", multi: false, allowManualEntry: false });
  if (result && result[0]) newUserId.value = result[0];
}

async function add() {
  if (!newUserId.value.trim()) return;
  addError.value = "";
  try {
    await apiCall(`/project-groups/${props.groupId}/admins`, {
      method: "POST",
      body: JSON.stringify({ userId: newUserId.value.trim() }),
    });
    newUserId.value = "";
    await load();
  } catch (err) {
    addError.value = err instanceof ApiError ? err.message : "등록에 실패했습니다";
  }
}

async function remove(userId: string) {
  try {
    await apiCall(`/project-groups/${props.groupId}/admins/${userId}`, { method: "DELETE" });
    await load();
  } catch (err) {
    addError.value = err instanceof ApiError ? err.message : "제거에 실패했습니다";
  }
}

onMounted(load);
</script>

<template>
  <div class="manager">
    <p class="hint">그룹 관리자는 이 그룹 산하 모든 프로젝트의 멤버 목록을 볼 수 있다 - 그 그룹이 속한 팀의 팀장도 자동으로 관리자 권한을 갖는다(따로 등록 없이).</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="admins">
      <li v-for="a in admins" :key="a.id">
        <UserRef :user-id="a.userId" />
        <button class="remove-btn" @click="remove(a.userId)">제거</button>
      </li>
      <li v-if="admins.length === 0" class="muted">명시적으로 등록된 그룹 관리자가 없습니다(팀장은 그래도 볼 수 있음).</li>
    </ul>
    <form class="add-row" @submit.prevent="add">
      <button type="button" class="pick-btn" @click="pickNewUser">{{ newUserId || "사용자 선택..." }}</button>
      <button type="submit">그룹 관리자 추가</button>
    </form>
    <p v-if="addError" class="error">{{ addError }}</p>
  </div>
</template>

<style scoped>
.manager {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 12px;
}
.hint {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 0 0 10px;
}
.admins {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
}
.admins li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border-light);
}
.admins li:last-child {
  border-bottom: none;
}
.remove-btn {
  margin-left: auto;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.add-row {
  display: flex;
  gap: 8px;
}
.pick-btn {
  flex: 1;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
}
.add-row button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
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
