<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

interface Institution {
  id: string;
  name: string;
  enabled: boolean;
}

const institutions = ref<Institution[]>([]);
const newName = ref("");
const error = ref("");
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    institutions.value = await apiCall<Institution[]>("/institutions");
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
    await apiCall("/institutions", { method: "POST", body: JSON.stringify({ name: newName.value.trim() }) });
    newName.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

onMounted(load);
</script>

<template>
  <h1>기관</h1>
  <form class="create-row" @submit.prevent="create">
    <input v-model="newName" type="text" placeholder="새 기관 이름" />
    <button type="submit">추가</button>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="inst in institutions" :key="inst.id">
      <span>{{ inst.name }}</span>
      <span class="muted">{{ inst.enabled ? "" : "(비활성)" }}</span>
    </li>
    <li v-if="institutions.length === 0" class="muted">아직 기관이 없습니다.</li>
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
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  display: flex;
  gap: 8px;
}
.list li:last-child {
  border-bottom: none;
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
