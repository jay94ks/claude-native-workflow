<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY } from "../utils/projectContext";

const props = defineProps<{ projectId: string }>();

// 문서 타입 CRUD·상태/전이 관리는 전부 프로젝트 owner 전용(백엔드
// requireProjectRole("owner")와 동일한 기준) - 타입 자체를 보는 건
// 누구나 가능, 관리 버튼만 owner에게만 보인다.
const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const isOwner = computed(() => myRole.value === "owner");

interface DocType {
  id: string;
  code: string;
  label: string;
  guideline: string | null;
  isDefault: boolean;
}
interface DocStatus {
  id: string;
  code: string;
  label: string;
  guideline: string | null;
  isTerminal: boolean;
}

const STANDARD_STATUS_CODES = ["draft", "review", "pending", "approved", "deprecated", "archived"];
interface DocStatusTransition {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  label: string | null;
}

// 문서 타입은 항상 그 프로젝트 자신에게만 정의된다(팀/그룹 단위로
// 획일화해 정하는 기능은 없음 - 설계자 확인) - 스코프 분기가 필요
// 없어졌다.
const basePath = computed(() => `/projects/${props.projectId}/doc-types`);
const listPath = basePath;

const types = ref<DocType[]>([]);
const loading = ref(true);
const error = ref("");

const newCode = ref("");
const newLabel = ref("");
const newGuideline = ref("");
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
      body: JSON.stringify({ code: newCode.value.trim(), label: newLabel.value.trim(), guideline: newGuideline.value.trim() || undefined }),
    });
    newCode.value = "";
    newLabel.value = "";
    newGuideline.value = "";
    await loadTypes();
  } catch (err) {
    createError.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

// ---------------------------------------------------------------- 이름(code/label) 수정 · 삭제

const editingId = ref<string | null>(null);
const editCode = ref("");
const editLabel = ref("");
const editError = ref("");
const deleteError = ref<Record<string, string>>({});

function startEditName(t: DocType) {
  editingId.value = t.id;
  editCode.value = t.code;
  editLabel.value = t.label;
  editError.value = "";
}

async function saveEditName() {
  if (!editingId.value) return;
  editError.value = "";
  try {
    await apiCall(`${basePath.value}/${editingId.value}`, {
      method: "PUT",
      body: JSON.stringify({ code: editCode.value.trim(), label: editLabel.value.trim() }),
    });
    editingId.value = null;
    await loadTypes();
  } catch (err) {
    editError.value = err instanceof ApiError ? err.message : "수정에 실패했습니다";
  }
}

async function removeType(t: DocType) {
  deleteError.value = { ...deleteError.value, [t.id]: "" };
  try {
    await apiCall(`${basePath.value}/${t.id}`, { method: "DELETE" });
    if (expandedId.value === t.id) expandedId.value = null;
    await loadTypes();
  } catch (err) {
    deleteError.value = {
      ...deleteError.value,
      [t.id]: err instanceof ApiError ? err.message : "삭제에 실패했습니다",
    };
  }
}

// ---------------------------------------------------------------- 펼친 타입의 상태/전이

const expandedId = ref<string | null>(null);
const statuses = ref<DocStatus[]>([]);
const transitions = ref<DocStatusTransition[]>([]);
const detailError = ref("");
const detailLoading = ref(false);

const newStatusCode = ref("");
const statusAddError = ref("");
const applyingStandardFlow = ref(false);
const standardFlowError = ref("");

const newTransitionFrom = ref("");
const newTransitionTo = ref("");
const newTransitionLabel = ref("");
const transitionAddError = ref("");

function statusCode(statusId: string): string {
  return statuses.value.find((s) => s.id === statusId)?.code ?? statusId;
}

// ---------------------------------------------------------------- 지침(guideline) 보기/수정

const editingGuideline = ref(false);
const guidelineDraft = ref("");
const guidelineSaving = ref(false);
const guidelineSaveError = ref("");

const expandedType = computed(() => types.value.find((t) => t.id === expandedId.value) ?? null);

function startEditGuideline() {
  guidelineDraft.value = expandedType.value?.guideline ?? "";
  guidelineSaveError.value = "";
  editingGuideline.value = true;
}

async function saveGuideline() {
  if (!expandedId.value) return;
  guidelineSaving.value = true;
  guidelineSaveError.value = "";
  try {
    await apiCall(`${basePath.value}/${expandedId.value}/guideline`, {
      method: "PUT",
      body: JSON.stringify({ guideline: guidelineDraft.value }),
    });
    editingGuideline.value = false;
    await loadTypes();
  } catch (err) {
    guidelineSaveError.value = err instanceof ApiError ? err.message : "지침 저장에 실패했습니다";
  } finally {
    guidelineSaving.value = false;
  }
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
  editingGuideline.value = false;
  await loadDetail(docTypeId);
}

async function addStatus() {
  if (!expandedId.value || !newStatusCode.value) return;
  statusAddError.value = "";
  try {
    await apiCall(`${basePath.value}/${expandedId.value}/statuses`, {
      method: "POST",
      body: JSON.stringify({ code: newStatusCode.value }),
    });
    newStatusCode.value = "";
    await loadDetail(expandedId.value);
  } catch (err) {
    statusAddError.value = err instanceof ApiError ? err.message : "상태 추가에 실패했습니다";
  }
}

async function applyStandardFlow() {
  if (!expandedId.value) return;
  applyingStandardFlow.value = true;
  standardFlowError.value = "";
  try {
    await apiCall(`${basePath.value}/${expandedId.value}/standard-flow`, { method: "POST" });
    await loadDetail(expandedId.value);
  } catch (err) {
    standardFlowError.value = err instanceof ApiError ? err.message : "표준 흐름 적용에 실패했습니다";
  } finally {
    applyingStandardFlow.value = false;
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
    <template v-if="isOwner">
      <form class="create-row" @submit.prevent="createType">
        <input v-model="newCode" type="text" placeholder="코드(영문 2글자)" maxlength="2" class="code-input" />
        <input v-model="newLabel" type="text" placeholder="라벨" />
        <button type="submit">타입 만들기</button>
      </form>
      <textarea
        v-model="newGuideline"
        class="guideline-input"
        rows="2"
        placeholder="이 타입은 무엇을 하기 위한 것인지(선택)"
      ></textarea>
      <p v-if="createError" class="error">{{ createError }}</p>
    </template>

    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="types">
      <li v-for="t in types" :key="t.id">
        <div class="type-row" @click="toggleExpand(t.id)">
          <template v-if="editingId === t.id">
            <input v-model="editCode" type="text" maxlength="2" class="code-input" @click.stop />
            <input v-model="editLabel" type="text" @click.stop />
            <button class="edit-btn" @click.stop="saveEditName">저장</button>
            <button class="edit-btn" @click.stop="editingId = null">취소</button>
          </template>
          <template v-else>
            <code>{{ t.code }}</code>
            <span>{{ t.label }}</span>
            <span v-if="t.isDefault" class="badge">기본 타입</span>
            <template v-if="isOwner">
              <button v-if="!t.isDefault" class="edit-btn" @click.stop="startEditName(t)">이름 수정</button>
              <button class="edit-btn" @click.stop="removeType(t)">삭제</button>
            </template>
          </template>
          <span class="toggle">{{ expandedId === t.id ? "▲" : "▼" }}</span>
        </div>
        <p v-if="editError && editingId === t.id" class="error inline">{{ editError }}</p>
        <p v-if="deleteError[t.id]" class="error inline">{{ deleteError[t.id] }}</p>
        <div v-if="expandedId === t.id" class="detail">
          <p v-if="detailError" class="error">{{ detailError }}</p>
          <p v-if="detailLoading" class="muted">불러오는 중...</p>
          <template v-else>
            <h4>지침</h4>
            <div v-if="!editingGuideline" class="guideline-view">
              <p v-if="expandedType?.guideline" class="guideline-text">{{ expandedType.guideline }}</p>
              <p v-else class="muted">지침 없음</p>
              <button v-if="isOwner" class="edit-btn" @click="startEditGuideline">수정</button>
            </div>
            <div v-else class="guideline-edit">
              <textarea v-model="guidelineDraft" rows="2" placeholder="이 타입은 무엇을 하기 위한 것인지"></textarea>
              <div class="guideline-edit-actions">
                <button :disabled="guidelineSaving" @click="saveGuideline">저장</button>
                <button type="button" class="cancel-btn" @click="editingGuideline = false">취소</button>
              </div>
              <p v-if="guidelineSaveError" class="error">{{ guidelineSaveError }}</p>
            </div>

            <h4>상태(표준 6개 어휘 - draft/review/pending/approved/deprecated/archived만 사용 가능)</h4>
            <ul class="statuses">
              <li v-for="s in statuses" :key="s.id">
                <code>{{ s.code }}</code> {{ s.label }}
                <span v-if="s.isTerminal" class="badge">종료</span>
                <span v-if="s.guideline" class="status-guideline">— {{ s.guideline }}</span>
              </li>
              <li v-if="statuses.length === 0" class="muted">상태가 없습니다 - 최소 하나는 있어야 문서를 만들 수 있습니다.</li>
            </ul>
            <form v-if="isOwner" class="add-row" @submit.prevent="addStatus">
              <select v-model="newStatusCode">
                <option value="">상태 코드 선택</option>
                <option v-for="c in STANDARD_STATUS_CODES" :key="c" :value="c">{{ c }}</option>
              </select>
              <button type="submit">상태 추가</button>
              <button type="button" class="standard-flow-btn" :disabled="applyingStandardFlow" @click="applyStandardFlow">
                표준 상태 흐름 한 번에 적용
              </button>
            </form>
            <p v-if="statusAddError" class="error">{{ statusAddError }}</p>
            <p v-if="standardFlowError" class="error">{{ standardFlowError }}</p>

            <h4>전이</h4>
            <ul class="transitions">
              <li v-for="tr in transitions" :key="tr.id">
                {{ statusCode(tr.fromStatusId) }} → {{ statusCode(tr.toStatusId) }}
                <span v-if="tr.label" class="muted">({{ tr.label }})</span>
              </li>
              <li v-if="transitions.length === 0" class="muted">정의된 전이가 없습니다.</li>
            </ul>
            <form v-if="isOwner" class="add-row" @submit.prevent="addTransition">
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
.code-input {
  width: 70px;
  text-transform: uppercase;
}
.create-row input,
.type-row input {
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
}
.guideline-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  margin-bottom: 4px;
}
.guideline-view {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}
.guideline-text {
  flex: 1;
  font-size: 13px;
  margin: 0;
  white-space: pre-wrap;
}
.edit-btn,
.guideline-edit-actions button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  flex-shrink: 0;
}
.edit-btn:hover {
  background: #eef0f6;
}
.guideline-edit textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}
.guideline-edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.guideline-edit-actions .cancel-btn {
  color: #888;
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
.status-guideline {
  color: #999;
  font-size: 12px;
  margin-left: 4px;
}
.standard-flow-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  color: #333;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
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
.error.inline {
  padding: 0 4px 6px;
  margin: 0;
}
</style>
