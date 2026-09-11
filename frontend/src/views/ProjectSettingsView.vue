<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import DocTypeManager from "../components/DocTypeManager.vue";
import GitRepoPanel from "../components/GitRepoPanel.vue";
import AccessControlManager from "../components/AccessControlManager.vue";
import UserRef from "../components/UserRef.vue";
import { useEntityPickerStore } from "../stores/entityPicker";

const entityPicker = useEntityPickerStore();

const props = defineProps<{ id: string }>();

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

const docTypes = ref<DocType[]>([]);
const members = ref<Member[]>([]);
const loading = ref(true);
const error = ref("");

const newMemberUserId = ref("");
const newMemberRole = ref("viewer");
const memberError = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [types, memberList] = await Promise.all([
      apiCall<DocType[]>(`/projects/${props.id}/doc-types`),
      apiCall<Member[]>(`/projects/${props.id}/members`),
    ]);
    docTypes.value = types;
    members.value = memberList;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "프로젝트 정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function pickNewMember() {
  const result = await entityPicker.pick({ kind: "user", projectId: props.id, multi: false, allowManualEntry: false });
  if (result && result[0]) newMemberUserId.value = result[0];
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
  <template v-else>
    <p v-if="error" class="error">{{ error }}</p>

    <section>
      <h2>git 저장소</h2>
      <GitRepoPanel :project-id="id" />
    </section>

    <section>
      <h2>문서 타입</h2>
      <p class="hint">이 프로젝트에서 문서를 만들 때 쓸 수 있는 타입 전체(이 프로젝트 자신 + 소속 그룹/팀에서 상속된 것).</p>
      <ul class="chips">
        <li v-for="t in docTypes" :key="t.id">{{ t.code }} · {{ t.label }}</li>
      </ul>
    </section>

    <section>
      <h2>문서 타입 관리</h2>
      <p class="hint">이 프로젝트가 직접 정의한 타입만 - 상속받은 타입은 실제로 정의된 그룹/팀 화면에서 관리한다.</p>
      <DocTypeManager scope="project" :scope-id="id" />
    </section>

    <section>
      <h2>멤버</h2>
      <form class="create-row" @submit.prevent="addMember">
        <button type="button" class="pick-btn" @click="pickNewMember">{{ newMemberUserId || "사용자 선택..." }}</button>
        <select v-model="newMemberRole">
          <option value="owner">owner</option>
          <option value="editor">editor</option>
          <option value="viewer">viewer</option>
        </select>
        <button type="submit">추가</button>
      </form>
      <p v-if="memberError" class="error">{{ memberError }}</p>
      <ul class="list">
        <li v-for="m in members" :key="m.id">
          <UserRef :user-id="m.userId" />
          <span class="muted">{{ m.role }}</span>
        </li>
        <li v-if="members.length === 0" class="muted">멤버가 없습니다.</li>
      </ul>
    </section>

    <section>
      <h2>접근 권한</h2>
      <p class="hint">
        협업 중인 설계자의 읽기/쓰기/삭제 권한을 공통/문서 타입별/개별 문서 단위로 더 좁게 제한(또는 넓게 예외 허용)할 수 있다.
      </p>
      <AccessControlManager :project-id="id" />
    </section>
  </template>
</template>

<style scoped>
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
section {
  margin-bottom: 28px;
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
.pick-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
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
