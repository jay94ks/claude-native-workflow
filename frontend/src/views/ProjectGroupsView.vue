<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

interface ProjectGroup {
  id: string;
  institutionId: string | null;
  name: string;
}
interface Institution {
  id: string;
  name: string;
}

const groups = ref<ProjectGroup[]>([]);
const institutions = ref<Institution[]>([]);
const newName = ref("");
const newInstitutionId = ref("");
const error = ref("");
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const [groupList, institutionList] = await Promise.all([
      apiCall<ProjectGroup[]>("/project-groups"),
      apiCall<Institution[]>("/institutions").catch(() => []),
    ]);
    groups.value = groupList;
    institutions.value = institutionList;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function institutionName(id: string | null): string {
  if (!id) return "-";
  return institutions.value.find((i) => i.id === id)?.name ?? id;
}

async function create() {
  if (!newName.value.trim()) return;
  error.value = "";
  try {
    await apiCall("/project-groups", {
      method: "POST",
      body: JSON.stringify({ name: newName.value.trim(), institutionId: newInstitutionId.value || undefined }),
    });
    newName.value = "";
    newInstitutionId.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

onMounted(load);
</script>

<template>
  <h1>프로젝트 그룹</h1>
  <form class="create-row" @submit.prevent="create">
    <input v-model="newName" type="text" placeholder="새 그룹 이름" />
    <select v-if="institutions.length > 0" v-model="newInstitutionId">
      <option value="">기관 없음</option>
      <option v-for="inst in institutions" :key="inst.id" :value="inst.id">{{ inst.name }}</option>
    </select>
    <button type="submit">추가</button>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="group in groups" :key="group.id">
      <span>{{ group.name }}</span>
      <span class="muted">{{ institutionName(group.institutionId) }}</span>
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
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
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
