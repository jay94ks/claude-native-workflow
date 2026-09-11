<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "./UserRef.vue";
import { useEntityPickerStore } from "../stores/entityPicker";

const props = defineProps<{ teamId: string }>();
const entityPicker = useEntityPickerStore();

interface TeamAdmin {
  id: string;
  userId: string;
}

const admins = ref<TeamAdmin[]>([]);
const loading = ref(true);
const error = ref("");
const newUserId = ref("");
const addError = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    admins.value = await apiCall<TeamAdmin[]>(`/teams/${props.teamId}/admins`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "팀장 목록을 불러오지 못했습니다";
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
    await apiCall(`/teams/${props.teamId}/admins`, {
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
    await apiCall(`/teams/${props.teamId}/admins/${userId}`, { method: "DELETE" });
    await load();
  } catch (err) {
    addError.value = err instanceof ApiError ? err.message : "제거에 실패했습니다";
  }
}

onMounted(load);
</script>

<template>
  <div class="manager">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="admins">
      <li v-for="a in admins" :key="a.id">
        <UserRef :user-id="a.userId" />
        <button class="remove-btn" @click="remove(a.userId)">제거</button>
      </li>
      <li v-if="admins.length === 0" class="muted">등록된 팀장이 없습니다.</li>
    </ul>
    <form class="add-row" @submit.prevent="add">
      <button type="button" class="pick-btn" @click="pickNewUser">{{ newUserId || "사용자 선택..." }}</button>
      <button type="submit">팀장 추가</button>
    </form>
    <p v-if="addError" class="error">{{ addError }}</p>
  </div>
</template>

<style scoped>
.manager {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 12px;
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
  border-bottom: 1px solid #eee;
}
.admins li:last-child {
  border-bottom: none;
}
.remove-btn {
  margin-left: auto;
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.add-row {
  display: flex;
  gap: 8px;
}
.add-row input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
}
.pick-btn {
  flex: 1;
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
}
.add-row button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
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
