<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";
import FolderSelectTree from "../components/FolderSelectTree.vue";
import { UNFILED_SENTINEL } from "../utils/folderTree";
import DocumentListPanel from "../components/DocumentListPanel.vue";

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
interface DocumentPage {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const recentDocuments = ref<DocumentSummary[]>([]);
const docTypes = ref<DocType[]>([]);
const error = ref("");

function docTypeLabel(id: string): string {
  const t = docTypes.value.find((dt) => dt.id === id);
  return t ? `${t.code} · ${t.label}` : id;
}

async function loadDocTypes() {
  try {
    docTypes.value = await apiCall<DocType[]>(`/projects/${props.id}/doc-types`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 분류 목록을 불러오지 못했습니다";
  }
}

async function loadRecent() {
  try {
    recentDocuments.value = await apiCall<DocumentSummary[]>(`/projects/${props.id}/documents/recent?limit=100`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  }
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

// ---------------------------------------------------------------- 서브탭(폴더/문서 분류/리스트) - #documents-tab-redesign

type SubTab = "folder" | "type" | "list";
const activeTab = ref<SubTab>("folder");

// ---------------------------------------------------------------- "폴더" 서브탭 (요청 1번)

const selectedFolderId = ref<string | null>(null);
const folderPage = ref<DocumentPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const folderLoading = ref(true);
const folderError = ref("");
const folderPageNum = ref(1);

async function loadFolderPage() {
  folderLoading.value = true;
  folderError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(folderPageNum.value), pageSize: "20" });
    const url =
      selectedFolderId.value === null
        ? `/projects/${props.id}/documents/page?${qs}`
        : selectedFolderId.value === UNFILED_SENTINEL
          ? `/projects/${props.id}/documents/unfiled/page?${qs}`
          : `/folders/${selectedFolderId.value}/documents/page?${qs}`;
    folderPage.value = await apiCall<DocumentPage>(url);
  } catch (err) {
    folderError.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    folderLoading.value = false;
  }
}
function onSelectFolder(folderId: string | null) {
  selectedFolderId.value = folderId;
  folderPageNum.value = 1;
  loadFolderPage();
}
function onFolderPageChange(page: number) {
  folderPageNum.value = page;
  loadFolderPage();
}

// ---------------------------------------------------------------- "문서 분류" 서브탭 (요청 2-2번)

const selectedDocTypeId = ref<string | null>(null);
const typePage = ref<DocumentPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const typeLoading = ref(true);
const typeError = ref("");
const typePageNum = ref(1);

async function loadTypePage() {
  typeLoading.value = true;
  typeError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(typePageNum.value), pageSize: "20" });
    if (selectedDocTypeId.value) qs.set("docTypeId", selectedDocTypeId.value);
    typePage.value = await apiCall<DocumentPage>(`/projects/${props.id}/documents/page?${qs}`);
  } catch (err) {
    typeError.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    typeLoading.value = false;
  }
}
function onSelectDocType(id: string | null) {
  selectedDocTypeId.value = id;
  typePageNum.value = 1;
  loadTypePage();
}
function onTypePageChange(page: number) {
  typePageNum.value = page;
  loadTypePage();
}

// ---------------------------------------------------------------- "리스트" 서브탭 (요청 2-1번)

type SortOption = "createdAt:desc" | "updatedAt:desc" | "createdAt:asc";
const sortOption = ref<SortOption>("createdAt:desc");
const listPage = ref<DocumentPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const listLoading = ref(true);
const listError = ref("");
const listPageNum = ref(1);

async function loadListPage() {
  listLoading.value = true;
  listError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(listPageNum.value), pageSize: "20", sort: sortOption.value });
    listPage.value = await apiCall<DocumentPage>(`/projects/${props.id}/documents/page?${qs}`);
  } catch (err) {
    listError.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    listLoading.value = false;
  }
}
function onSortChange() {
  listPageNum.value = 1;
  loadListPage();
}
function onListPageChange(page: number) {
  listPageNum.value = page;
  loadListPage();
}

// 탭을 처음 열 때만 그 탭의 목록을 불러온다(전부 미리 불러올 필요 없음).
const loadedTabs = new Set<SubTab>();
function ensureTabLoaded(tab: SubTab) {
  if (loadedTabs.has(tab)) return;
  loadedTabs.add(tab);
  if (tab === "folder") loadFolderPage();
  else if (tab === "type") loadTypePage();
  else loadListPage();
}
watch(activeTab, (tab) => ensureTabLoaded(tab), { immediate: false });

onMounted(async () => {
  await loadDocTypes();
  if (isRecentMode.value) {
    await loadRecent();
  } else {
    ensureTabLoaded(activeTab.value);
  }
});
</script>

<template>
  <div class="layout">
    <h2 v-if="isRecentMode" class="recent-heading">최근 변경된 문서(변경 순)</h2>
    <ul v-if="isRecentMode" class="recent-list">
      <li v-for="doc in recentDocuments" :key="doc.trackingCode">
        <router-link :to="`/projects/${id}/documents/${doc.trackingCode}`">
          <code>{{ doc.trackingCode }}</code> {{ doc.title }}
        </router-link>
        <span class="right">
          <span class="muted">{{ docTypeLabel(doc.docTypeId) }} · {{ doc.statusCode }}</span>
        </span>
      </li>
      <li v-if="recentDocuments.length === 0" class="muted">문서가 없습니다.</li>
    </ul>

    <template v-else>
      <form v-if="canCreateDocument" class="create-row" @submit.prevent="create">
        <input v-model="newTitle" type="text" placeholder="새 문서 제목" />
        <select v-model="newTypeCode">
          <option v-for="t in docTypes" :key="t.id" :value="t.code">{{ t.code }}</option>
        </select>
        <button type="submit">만들기</button>
      </form>
      <p v-if="canCreateDocument && selectedTypeGuideline" class="guideline-hint">{{ selectedTypeGuideline }}</p>
      <p v-if="error" class="error">{{ error }}</p>

      <nav class="subtabs">
        <button type="button" :class="{ active: activeTab === 'folder' }" @click="activeTab = 'folder'">폴더</button>
        <button type="button" :class="{ active: activeTab === 'type' }" @click="activeTab = 'type'">문서 분류</button>
        <button type="button" :class="{ active: activeTab === 'list' }" @click="activeTab = 'list'">리스트</button>
      </nav>

      <!-- 요청 1번: 폴더 좌측 + 선택된 폴더(또는 전체)의 문서 우측 -->
      <div v-if="activeTab === 'folder'" class="split">
        <FolderSelectTree :project-id="id" :selected-folder-id="selectedFolderId" @select="onSelectFolder" />
        <DocumentListPanel
          :project-id="id"
          :items="folderPage.items"
          :doc-types="docTypes"
          :page="folderPage.page"
          :total-pages="folderPage.totalPages"
          :total="folderPage.total"
          :loading="folderLoading"
          :error="folderError"
          @page-change="onFolderPageChange"
        />
      </div>

      <!-- 요청 2-2번: 문서 분류 좌측 + 그 분류의 문서 우측 -->
      <div v-else-if="activeTab === 'type'" class="split">
        <div class="type-list">
          <div class="type-item" :class="{ selected: selectedDocTypeId === null }" @click="onSelectDocType(null)">전체 분류</div>
          <div
            v-for="t in docTypes"
            :key="t.id"
            class="type-item"
            :class="{ selected: selectedDocTypeId === t.id }"
            @click="onSelectDocType(t.id)"
          >
            {{ t.code }} · {{ t.label }}
          </div>
        </div>
        <DocumentListPanel
          :project-id="id"
          :items="typePage.items"
          :doc-types="docTypes"
          :page="typePage.page"
          :total-pages="typePage.totalPages"
          :total="typePage.total"
          :loading="typeLoading"
          :error="typeError"
          @page-change="onTypePageChange"
        />
      </div>

      <!-- 요청 2-1번: 정렬 콤보박스 + 전체 문서 리스트 -->
      <div v-else class="list-tab">
        <div class="sort-row">
          <select v-model="sortOption" @change="onSortChange">
            <option value="createdAt:desc">최신순</option>
            <option value="updatedAt:desc">최근 수정순</option>
            <option value="createdAt:asc">오래된 순</option>
          </select>
        </div>
        <DocumentListPanel
          :project-id="id"
          :items="listPage.items"
          :doc-types="docTypes"
          :page="listPage.page"
          :total-pages="listPage.totalPages"
          :total="listPage.total"
          :loading="listLoading"
          :error="listError"
          @page-change="onListPageChange"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.recent-heading {
  font-size: 15px;
  margin: 0 0 12px;
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
.subtabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.subtabs button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
}
.subtabs button:hover {
  background: var(--color-surface-hover);
}
.subtabs button.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.split {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.type-list {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px;
  min-width: 220px;
  flex-shrink: 0;
}
.type-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.type-item:hover {
  background: var(--color-surface-hover);
}
.type-item.selected {
  background: var(--color-primary);
  color: #fff;
}
.list-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sort-row {
  display: flex;
  justify-content: flex-end;
}
.sort-row select {
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.recent-list {
  list-style: none;
  padding: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.recent-list li {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.recent-list li:last-child {
  border-bottom: none;
}
.recent-list code {
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
