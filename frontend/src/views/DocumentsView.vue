<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import FolderTree from "../components/FolderTree.vue";
import Pagination from "../components/Pagination.vue";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ id: string }>();
const router = useRouter();
const route = useRoute();
const isRecentMode = computed(() => route.query.recent === "1");

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canCreateDocument = computed(() => roleSatisfies(myRole.value, "editor"));

interface DocumentSummary {
  trackingCode: string;
  title: string;
  docTypeId: string;
  statusCode: string;
}
interface DocType {
  id: string;
  code: string;
  label: string;
  guideline: string | null;
}
interface FolderDocument {
  trackingCode: string;
  title: string;
  docTypeId: string;
}
interface DocumentPage {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
interface BulkResultItem {
  trackingCode: string;
  ok: boolean;
  error?: string;
  statusCode?: string;
}

const STANDARD_STATUS_CODES = ["draft", "review", "pending", "approved", "deprecated", "archived"];

const PAGE_SIZE = 20;
const documents = ref<DocumentSummary[]>([]);
const docTypes = ref<DocType[]>([]);
const filterTypeId = ref("");
const loading = ref(true);
const error = ref("");
const selectedFolderId = ref<string | null>(null);
const moveError = ref("");
const page = ref(1);
const totalPages = ref(1);

// ---------------------------------------------------------------- 일괄 작업(상태 전이/폴더 이동)

const selectedCodes = ref<Set<string>>(new Set());
const bulkTargetStatus = ref("");
const bulkTargetFolder = ref("");
const bulkBusy = ref(false);
const bulkResult = ref<BulkResultItem[] | null>(null);

const allSelected = computed(() => documents.value.length > 0 && documents.value.every((d) => selectedCodes.value.has(d.trackingCode)));

function toggleSelectAll() {
  if (allSelected.value) {
    selectedCodes.value = new Set();
  } else {
    selectedCodes.value = new Set(documents.value.map((d) => d.trackingCode));
  }
}

function toggleSelect(trackingCode: string) {
  const next = new Set(selectedCodes.value);
  if (next.has(trackingCode)) next.delete(trackingCode);
  else next.add(trackingCode);
  selectedCodes.value = next;
}

function bulkSummary(results: BulkResultItem[]): string {
  const failed = results.filter((r) => !r.ok);
  return `${results.length - failed.length}개 성공, ${failed.length}개 실패`;
}

async function applyBulkTransition() {
  if (selectedCodes.value.size === 0 || !bulkTargetStatus.value) return;
  bulkBusy.value = true;
  bulkResult.value = null;
  try {
    const results = await apiCall<BulkResultItem[]>("/documents/bulk-transition", {
      method: "POST",
      body: JSON.stringify({ trackingCodes: [...selectedCodes.value], toStatusCode: bulkTargetStatus.value }),
    });
    bulkResult.value = results;
    // 성공한 항목만 선택 해제 - 실패한 항목은 다시 시도하거나 다른
    // 작업으로 바꿀 수 있도록 선택 상태를 유지한다.
    const succeeded = new Set(results.filter((r) => r.ok).map((r) => r.trackingCode));
    selectedCodes.value = new Set([...selectedCodes.value].filter((c) => !succeeded.has(c)));
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "일괄 전이에 실패했습니다";
  } finally {
    bulkBusy.value = false;
  }
}

async function applyBulkFolderMove() {
  if (selectedCodes.value.size === 0) return;
  bulkBusy.value = true;
  bulkResult.value = null;
  try {
    const results = await apiCall<BulkResultItem[]>("/documents/bulk-folder", {
      method: "PUT",
      body: JSON.stringify({ trackingCodes: [...selectedCodes.value], folderId: bulkTargetFolder.value || null }),
    });
    bulkResult.value = results;
    const succeeded = new Set(results.filter((r) => r.ok).map((r) => r.trackingCode));
    selectedCodes.value = new Set([...selectedCodes.value].filter((c) => !succeeded.has(c)));
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "일괄 폴더 이동에 실패했습니다";
  } finally {
    bulkBusy.value = false;
  }
}

function docTypeLabel(id: string): string {
  const t = docTypes.value.find((dt) => dt.id === id);
  return t ? `${t.code} · ${t.label}` : id;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    docTypes.value = await apiCall<DocType[]>(`/projects/${props.id}/doc-types`);
    if (isRecentMode.value) {
      // 홈 대시보드 "더보기" - 폴더/타입 필터 무시하고 변경 순 전체를 보여준다.
      documents.value = await apiCall<DocumentSummary[]>(`/projects/${props.id}/documents/recent?limit=100`);
      totalPages.value = 1;
    } else if (selectedFolderId.value) {
      // 폴더 전용 목록은 상태 코드를 안 담고 있어 표시용으로 "-"를 채운다
      // (폴더는 DB 전용 정리 기능이라 검색 인덱스를 안 거치는 별도 경로,
      // 페이지네이션 대상도 아님 - 개인 정리 목적이라 목록이 짧음).
      const folderDocs = await apiCall<FolderDocument[]>(`/folders/${selectedFolderId.value}/documents`);
      documents.value = folderDocs.map((d) => ({ ...d, statusCode: "-" }));
      totalPages.value = 1;
    } else {
      const qs = new URLSearchParams({ page: String(page.value), pageSize: String(PAGE_SIZE) });
      if (filterTypeId.value) qs.set("docTypeId", filterTypeId.value);
      const result = await apiCall<DocumentPage>(`/projects/${props.id}/documents/page?${qs}`);
      documents.value = result.items;
      totalPages.value = result.totalPages;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function onFolderSelect(folderId: string | null) {
  selectedFolderId.value = folderId;
  page.value = 1;
  load();
}

interface FolderOption {
  id: string;
  name: string;
}
const folderOptions = ref<FolderOption[]>([]);
async function loadFolderOptions() {
  try {
    folderOptions.value = await apiCall<FolderOption[]>(`/projects/${props.id}/folders`);
  } catch {
    folderOptions.value = [];
  }
}

async function moveToFolder(trackingCode: string, folderId: string) {
  moveError.value = "";
  try {
    await apiCall(`/documents/${trackingCode}/folder`, {
      method: "PUT",
      body: JSON.stringify({ folderId: folderId || null }),
    });
    await load();
  } catch (err) {
    moveError.value = err instanceof ApiError ? err.message : "폴더 이동에 실패했습니다";
  }
}

async function removeFromFolder(trackingCode: string) {
  await moveToFolder(trackingCode, "");
}

const newTitle = ref("");
const newTypeCode = ref("");
async function create() {
  if (!newTitle.value.trim() || !newTypeCode.value.trim()) return;
  error.value = "";
  try {
    const doc = await apiCall<{ trackingCode: string }>(`/projects/${props.id}/documents`, {
      method: "POST",
      body: JSON.stringify({ docTypeCode: newTypeCode.value.trim(), title: newTitle.value.trim(), body: "" }),
    });
    newTitle.value = "";
    router.push(`/projects/${props.id}/documents/${doc.trackingCode}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

watch(docTypes, (types) => {
  if (types.length > 0 && !newTypeCode.value) newTypeCode.value = types[0].code;
});

const selectedTypeGuideline = computed(() => docTypes.value.find((t) => t.code === newTypeCode.value)?.guideline ?? null);

onMounted(async () => {
  await load();
  await loadFolderOptions();
});
watch(filterTypeId, () => {
  page.value = 1;
  load();
});
watch(page, load);
</script>

<template>
  <div class="layout">
    <FolderTree v-if="!isRecentMode" :project-id="id" @select="onFolderSelect" />

    <div class="main">
      <h2 v-if="isRecentMode" class="recent-heading">최근 변경된 문서(변경 순)</h2>

      <template v-if="!isRecentMode">
        <div class="filter-row">
          <select v-if="!selectedFolderId" v-model="filterTypeId">
            <option value="">전체 타입</option>
            <option v-for="t in docTypes" :key="t.id" :value="t.id">{{ t.code }} · {{ t.label }}</option>
          </select>
        </div>

        <form v-if="canCreateDocument" class="create-row" @submit.prevent="create">
          <input v-model="newTitle" type="text" placeholder="새 문서 제목" />
          <select v-model="newTypeCode">
            <option v-for="t in docTypes" :key="t.id" :value="t.code">{{ t.code }}</option>
          </select>
          <button type="submit">만들기</button>
        </form>
        <p v-if="canCreateDocument && selectedTypeGuideline" class="guideline-hint">{{ selectedTypeGuideline }}</p>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="moveError" class="error">{{ moveError }}</p>

      <div v-if="!loading && documents.length > 0" class="select-all-row">
        <label class="checkbox-label"><input type="checkbox" :checked="allSelected" @change="toggleSelectAll" /> 전체 선택</label>
        <span v-if="selectedCodes.size > 0" class="muted">{{ selectedCodes.size }}개 선택됨</span>
      </div>
      <div v-if="selectedCodes.size > 0" class="bulk-bar">
        <div class="bulk-action">
          <select v-model="bulkTargetStatus">
            <option value="">상태 선택</option>
            <option v-for="c in STANDARD_STATUS_CODES" :key="c" :value="c">{{ c }}</option>
          </select>
          <button type="button" :disabled="!bulkTargetStatus || bulkBusy" @click="applyBulkTransition">일괄 전이</button>
        </div>
        <div class="bulk-action">
          <select v-model="bulkTargetFolder">
            <option value="">폴더에서 빼기</option>
            <option v-for="f in folderOptions" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
          <button type="button" :disabled="bulkBusy" @click="applyBulkFolderMove">일괄 폴더 이동</button>
        </div>
      </div>
      <div v-if="bulkResult" class="bulk-result">
        <p class="bulk-summary">{{ bulkSummary(bulkResult) }}</p>
        <ul v-if="bulkResult.some((r) => !r.ok)" class="bulk-errors">
          <li v-for="r in bulkResult.filter((r) => !r.ok)" :key="r.trackingCode">
            <code>{{ r.trackingCode }}</code>: {{ r.error }}
          </li>
        </ul>
      </div>

      <p v-if="loading">불러오는 중...</p>
      <ul v-else class="list">
        <li v-for="doc in documents" :key="doc.trackingCode">
          <label class="row-checkbox"><input type="checkbox" :checked="selectedCodes.has(doc.trackingCode)" @change="toggleSelect(doc.trackingCode)" /></label>
          <router-link :to="`/projects/${id}/documents/${doc.trackingCode}`">
            <code>{{ doc.trackingCode }}</code> {{ doc.title }}
          </router-link>
          <span class="right">
            <span class="muted">{{ docTypeLabel(doc.docTypeId) }} · {{ doc.statusCode }}</span>
            <button v-if="selectedFolderId" class="move-btn" @click="removeFromFolder(doc.trackingCode)">폴더에서 빼기</button>
            <select v-else class="move-select" @change="moveToFolder(doc.trackingCode, ($event.target as HTMLSelectElement).value)">
              <option value="">폴더에 넣기...</option>
              <option v-for="f in folderOptions" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
          </span>
        </li>
        <li v-if="documents.length === 0" class="muted">문서가 없습니다.</li>
      </ul>
      <Pagination v-if="!isRecentMode && !selectedFolderId" :page="page" :total-pages="totalPages" @update:page="page = $event" />
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.main {
  flex: 1;
  min-width: 0;
}
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.move-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
}
.move-select {
  padding: 4px 6px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 11px;
  background: var(--color-surface);
  color: var(--color-text);
}
.recent-heading {
  font-size: 15px;
  margin: 0 0 12px;
}
.select-all-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 13px;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.row-checkbox {
  display: flex;
  align-items: center;
  margin-right: 10px;
  cursor: pointer;
}
.bulk-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  background: var(--color-info-bg);
  border: 1px solid var(--color-info-border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.bulk-action {
  display: flex;
  gap: 6px;
  align-items: center;
}
.bulk-action select {
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
}
.bulk-action button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}
.bulk-action button:disabled {
  background: var(--color-primary-muted);
}
.bulk-result {
  margin-bottom: 10px;
}
.bulk-summary {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0 0 4px;
}
.bulk-errors {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12px;
  color: var(--color-danger);
}
.bulk-errors li {
  padding: 2px 0;
}
.bulk-errors code {
  background: var(--color-surface-hover);
  padding: 1px 5px;
  border-radius: 4px;
}
.filter-row {
  margin-bottom: 12px;
}
.filter-row select {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.create-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.create-row select {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.create-row button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.guideline-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: -12px 0 16px;
}
.list {
  list-style: none;
  padding: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.list li:last-child {
  border-bottom: none;
}
.list code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 6px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
  white-space: nowrap;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
