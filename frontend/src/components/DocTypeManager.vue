<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ scope: "project" | "group" | "institution"; scopeId: string }>();

interface DocType {
  id: string;
  code: string;
  label: string;
}
interface DocStatus {
  id: string;
  code: string;
  label: string;
  isTerminal: boolean;
}
interface DocStatusTransition {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  label: string | null;
}

// 스코프별로 생성/목록에 쓰는 API 접두사만 다르고 나머지는 동일 -
// core/docTypes.ts의 세 스코프 라우트(institutions/:id/doc-types,
// project-groups/:id/doc-types, projects/:id/doc-types)를 그대로 거울처럼
// 반영한다.
const basePath = computed(() => {
  if (props.scope === "institution") return `/institutions/${props.scopeId}/doc-types`;
  if (props.scope === "group") return `/project-groups/${props.scopeId}/doc-types`;
  return `/projects/${props.scopeId}/doc-types`;
});
// 프로젝트 스코프의 GET .../doc-types는 상속 병합 목록이라(문서 생성
// 드롭다운용) 관리 화면은 "이 스코프에 직접 정의된 것"만 보는 /own을
// 대신 쓴다 - 그룹/기관은 애초에 직접 정의분만 반환하는 라우트라 그대로.
const listPath = computed(() => (props.scope === "project" ? `${basePath.value}/own` : basePath.value));

const types = ref<DocType[]>([]);
const loading = ref(true);
const error = ref("");

const newCode = ref("");
const newLabel = ref("");
const createError = ref("");

async function loadTypes() {
  loading.value = true;
  error.value = "";
  try {
    types.value = await apiCall<DocType[]>(listPath.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 타입 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function createType() {
  if (!newCode.value.trim() || !newLabel.value.trim()) return;
  createError.value = "";
  try {
    await apiCall(basePath.value, {
      method: "POST",
      body: JSON.stringify({ code: newCode.value.trim(), label: newLabel.value.trim() }),
    });
    newCode.value = "";
    newLabel.value = "";
    await loadTypes();
  } catch (err) {
    createError.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

// ---------------------------------------------------------------- 펼친 타입의 상태/전이

const expandedId = ref<string | null>(null);
const statuses = ref<DocStatus[]>([]);
const transitions = ref<DocStatusTransition[]>([]);
const detailError = ref("");
const detailLoading = ref(false);

const newStatusCode = ref("");
const newStatusLabel = ref("");
const newStatusTerminal = ref(false);
const statusAddError = ref("");

const newTransitionFrom = ref("");
const newTransitionTo = ref("");
const newTransitionLabel = ref("");
const transitionAddError = ref("");

function statusCode(statusId: string): string {
  return statuses.value.find((s) => s.id === statusId)?.code ?? statusId;
}

async function loadDetail(docTypeId: string) {
  detailLoading.value = true;
  detailError.value = "";
  try {
    const [statusList, transitionList] = await Promise.all([
      apiCall<DocStatus[]>(`/doc-types/${docTypeId}/statuses`),
      apiCall<DocStatusTransition[]>(`/doc-types/${docTypeId}/transitions`),
    ]);
    statuses.value = statusList;
    transitions.value = transitionList;
  } catch (err) {
    detailError.value = err instanceof ApiError ? err.message : "상태/전이를 불러오지 못했습니다";
  } finally {
    detailLoading.value = false;
  }
}

async function toggleExpand(docTypeId: string) {
  if (expandedId.value === docTypeId) {
    expandedId.value = null;
    return;
  }
  expandedId.value = docTypeId;
  statusAddError.value = "";
  transitionAddError.value = "";
  await loadDetail(docTypeId);
}

async function addStatus() {
  if (!expandedId.value || !newStatusCode.value.trim() || !newStatusLabel.value.trim()) return;
  statusAddError.value = "";
  try {
    await apiCall(`${basePath.value}/${expandedId.value}/statuses`, {
      method: "POST",
      body: JSON.stringify({
        code: newStatusCode.value.trim(),
        label: newStatusLabel.value.trim(),
        isTerminal: newStatusTerminal.value,
      }),
    });
    newStatusCode.value = "";
    newStatusLabel.value = "";
    newStatusTerminal.value = false;
    await loadDetail(expandedId.value);
  } catch (err) {
    statusAddError.value = err instanceof ApiError ? err.message : "상태 추가에 실패했습니다";
  }
}

async function addTransition() {
  if (!expandedId.value || !newTransitionFrom.value || !newTransitionTo.value) return;
  transitionAddError.value = "";
  try {
    await apiCall(`${basePath.value}/${expandedId.value}/transitions`, {
      method: "POST",
      body: JSON.stringify({
        fromStatusCode: newTransitionFrom.value,
        toStatusCode: newTransitionTo.value,
        label: newTransitionLabel.value.trim() || undefined,
      }),
    });
    newTransitionFrom.value = "";
    newTransitionTo.value = "";
    newTransitionLabel.value = "";
    await loadDetail(expandedId.value);
  } catch (err) {
    transitionAddError.value = err instanceof ApiError ? err.message : "전이 추가에 실패했습니다";
  }
}

onMounted(loadTypes);
</script>

<template>
  <div class="manager">
    <p v-if="error" class="error">{{ error }}</p>
    <form class="create-row" @submit.prevent="createType">
      <input v-model="newCode" type="text" placeholder="코드(영문 2글자)" maxlength="2" class="code-input" />
      <input v-model="newLabel" type="text" placeholder="라벨" />
      <button type="submit">타입 만들기</button>
    </form>
    <p v-if="createError" class="error">{{ createError }}</p>

    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="types">
      <li v-for="t in types" :key="t.id">
        <div class="type-row" @click="toggleExpand(t.id)">
          <code>{{ t.code }}</code>
          <span>{{ t.label }}</span>
          <span class="toggle">{{ expandedId === t.id ? "▲" : "▼" }}</span>
        </div>
        <div v-if="expandedId === t.id" class="detail">
          <p v-if="detailError" class="error">{{ detailError }}</p>
          <p v-if="detailLoading" class="muted">불러오는 중...</p>
          <template v-else>
            <h4>상태</h4>
            <ul class="statuses">
              <li v-for="s in statuses" :key="s.id">
                <code>{{ s.code }}</code> {{ s.label }}
                <span v-if="s.isTerminal" class="badge">종료</span>
              </li>
              <li v-if="statuses.length === 0" class="muted">상태가 없습니다 - 최소 하나는 있어야 문서를 만들 수 있습니다.</li>
            </ul>
            <form class="add-row" @submit.prevent="addStatus">
              <input v-model="newStatusCode" type="text" placeholder="상태 코드" />
              <input v-model="newStatusLabel" type="text" placeholder="라벨" />
              <label class="checkbox"><input v-model="newStatusTerminal" type="checkbox" /> 종료 상태</label>
              <button type="submit">상태 추가</button>
            </form>
            <p v-if="statusAddError" class="error">{{ statusAddError }}</p>

            <h4>전이</h4>
            <ul class="transitions">
              <li v-for="tr in transitions" :key="tr.id">
                {{ statusCode(tr.fromStatusId) }} → {{ statusCode(tr.toStatusId) }}
                <span v-if="tr.label" class="muted">({{ tr.label }})</span>
              </li>
              <li v-if="transitions.length === 0" class="muted">정의된 전이가 없습니다.</li>
            </ul>
            <form class="add-row" @submit.prevent="addTransition">
              <select v-model="newTransitionFrom">
                <option value="">시작 상태</option>
                <option v-for="s in statuses" :key="s.id" :value="s.code">{{ s.code }}</option>
              </select>
              <select v-model="newTransitionTo">
                <option value="">도착 상태</option>
                <option v-for="s in statuses" :key="s.id" :value="s.code">{{ s.code }}</option>
              </select>
              <input v-model="newTransitionLabel" type="text" placeholder="라벨(선택)" />
              <button type="submit">전이 추가</button>
            </form>
            <p v-if="transitionAddError" class="error">{{ transitionAddError }}</p>
          </template>
        </div>
      </li>
      <li v-if="types.length === 0" class="muted">아직 정의된 타입이 없습니다.</li>
    </ul>
  </div>
</template>

<style scoped>
.manager {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 12px;
}
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}
.create-row .code-input {
  width: 70px;
  text-transform: uppercase;
}
.create-row input {
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
}
.create-row button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
}
.types {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}
.types > li {
  border-top: 1px solid #eee;
}
.types > li:first-child {
  border-top: none;
}
.type-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  cursor: pointer;
  font-size: 13px;
}
.type-row:hover {
  background: #f8f9fb;
}
.type-row code {
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.type-row .toggle {
  margin-left: auto;
  color: #999;
  font-size: 11px;
}
.detail {
  padding: 4px 12px 14px 12px;
  background: #fafbfc;
}
.detail h4 {
  font-size: 12px;
  color: #666;
  margin: 10px 0 6px;
}
.statuses,
.transitions {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
}
.statuses li,
.transitions li {
  padding: 4px 0;
}
.statuses code {
  background: #f0f1f5;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.badge {
  background: #e4e9fb;
  color: #3454d1;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  margin-left: 6px;
}
.add-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.add-row input,
.add-row select {
  padding: 5px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 12px;
}
.add-row button {
  background: #fff;
  border: 1px solid #3454d1;
  color: #3454d1;
  padding: 5px 10px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.checkbox {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
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
