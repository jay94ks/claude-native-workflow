<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY } from "../utils/projectContext";

const props = defineProps<{ projectId: string }>();

// 문서 타입 CRUD·상태 관리는 전부 프로젝트 owner 전용(백엔드
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
const detailError = ref("");
const detailLoading = ref(false);

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
    statuses.value = await apiCall<DocStatus[]>(`/doc-types/${docTypeId}/statuses`);
  } catch (err) {
    detailError.value = err instanceof ApiError ? err.message : "상태를 불러오지 못했습니다";
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
  editingGuideline.value = false;
  await loadDetail(docTypeId);
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
          </template>
        </div>
      </li>
      <li v-if="types.length === 0" class="muted">아직 정의된 타입이 없습니다.</li>
    </ul>
  </div>
</template>

<style scoped>
.manager {
  background: var(--color-surface);
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
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.guideline-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  margin-bottom: 4px;
  background: var(--color-surface);
  color: var(--color-text);
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
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  flex-shrink: 0;
}
.edit-btn:hover {
  background: var(--color-surface-hover);
}
.guideline-edit textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-text);
}
.guideline-edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.guideline-edit-actions .cancel-btn {
  color: var(--color-text-muted);
}
.create-row button {
  background: var(--color-primary);
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
  border-top: 1px solid var(--color-border-light);
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
  background: var(--color-surface-hover);
}
.type-row code {
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.type-row .toggle {
  margin-left: auto;
  color: var(--color-text-faint);
  font-size: 11px;
}
.detail {
  padding: 4px 12px 14px 12px;
  background: var(--color-bg);
}
.detail h4 {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 10px 0 6px;
}
.statuses {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
}
.statuses li {
  padding: 4px 0;
}
.statuses code {
  background: var(--color-surface-hover);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.badge {
  background: var(--color-tcode-hover-bg);
  color: var(--color-primary);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  margin-left: 6px;
}
.status-guideline {
  color: var(--color-text-faint);
  font-size: 12px;
  margin-left: 4px;
}
.checkbox {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
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
  padding: 0 4px 6px;
  margin: 0;
}
</style>
