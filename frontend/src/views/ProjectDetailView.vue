<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ id: string }>();

interface Project {
  id: string;
  name: string;
  projectGroupId: string;
}
interface DocType {
  id: string;
  code: string;
  label: string;
}
interface Member {
  id: string;
  userId: string;
  role: string;
}
interface GitRepo {
  provider: string;
  repoUrl: string;
}

const project = ref<Project | null>(null);
const docTypes = ref<DocType[]>([]);
const members = ref<Member[]>([]);
const gitRepo = ref<GitRepo | null>(null);
const loading = ref(true);
const error = ref("");

const newMemberUserId = ref("");
const newMemberRole = ref("viewer");
const memberError = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [proj, types, memberList] = await Promise.all([
      apiCall<Project>(`/projects/${props.id}`),
      apiCall<DocType[]>(`/projects/${props.id}/doc-types`),
      apiCall<Member[]>(`/projects/${props.id}/members`),
    ]);
    project.value = proj;
    docTypes.value = types;
    members.value = memberList;
    gitRepo.value = await apiCall<GitRepo>(`/projects/${props.id}/git/repo`).catch(() => null);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "프로젝트 정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function addMember() {
  if (!newMemberUserId.value.trim()) return;
  memberError.value = "";
  try {
    await apiCall(`/projects/${props.id}/members`, {
      method: "POST",
      body: JSON.stringify({ userId: newMemberUserId.value.trim(), role: newMemberRole.value }),
    });
    newMemberUserId.value = "";
    members.value = await apiCall<Member[]>(`/projects/${props.id}/members`);
  } catch (err) {
    memberError.value = err instanceof ApiError ? err.message : "멤버 추가에 실패했습니다";
  }
}

onMounted(load);
</script>

<template>
  <p v-if="loading">불러오는 중...</p>
  <template v-else-if="project">
    <h1>{{ project.name }}</h1>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="nav-links">
      <router-link :to="`/projects/${id}/documents`">문서 보기</router-link>
      <router-link :to="`/projects/${id}/source`">소스 코드 보기</router-link>
    </div>

    <section>
      <h2>git 저장소</h2>
      <p v-if="gitRepo">{{ gitRepo.provider }} - {{ gitRepo.repoUrl }}</p>
      <p v-else class="muted">연결된 git 저장소가 없습니다(`docs git link`로 연결).</p>
    </section>

    <section>
      <h2>문서 타입</h2>
      <ul class="chips">
        <li v-for="t in docTypes" :key="t.id">{{ t.code }} · {{ t.label }}</li>
      </ul>
    </section>

    <section>
      <h2>멤버</h2>
      <form class="create-row" @submit.prevent="addMember">
        <input v-model="newMemberUserId" type="text" placeholder="사용자 id" />
        <select v-model="newMemberRole">
          <option value="owner">owner</option>
          <option value="editor">editor</option>
          <option value="viewer">viewer</option>
        </select>
        <button type="submit">추가</button>
      </form>
      <p v-if="memberError" class="error">{{ memberError }}</p>
      <p class="hint">
        사용자 id는 현재 CLI(<code>docs auth whoami</code> 등)나 가입 응답에서 확인할 수 있다 - 사용자 검색 화면은
        아직 없다.
      </p>
      <ul class="list">
        <li v-for="m in members" :key="m.id">
          <span>{{ m.userId }}</span>
          <span class="muted">{{ m.role }}</span>
        </li>
        <li v-if="members.length === 0" class="muted">멤버가 없습니다.</li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 20px;
}
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
section {
  margin-bottom: 28px;
}
.nav-links {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
}
.nav-links a {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  text-decoration: none;
  color: #1a1a2e;
}
.nav-links a:hover {
  background: #eef0f6;
}
.chips {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chips li {
  background: #fff;
  border: 1px solid #e2e4ea;
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 13px;
}
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
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
.hint {
  font-size: 12px;
  color: #999;
  margin: 0 0 12px;
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
  padding: 10px 16px;
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
