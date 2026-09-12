<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useEntityPickerStore } from "../stores/entityPicker";
import { nextDialogZIndex } from "../dialogZIndex";
import Pagination from "./Pagination.vue";

interface Item {
  key: string;
  label: string;
}

const store = useEntityPickerStore();

const items = ref<Item[]>([]);
const loading = ref(false);
const error = ref("");
const search = ref("");
const selected = ref<Set<string>>(new Set());
const manualEntry = ref("");
const zIndex = ref(1100);

interface DocumentSummary {
  trackingCode: string;
  title: string;
}
interface UserListItem {
  id: string;
  displayLabel: string;
}

// sourceFile 선택은 평평한 전체 목록(/git/tree/all - 재귀 전체) 대신
// SourceBrowserView.vue와 같은 지연 디렉터리 탐색(/git/tree?path=)을
// 쓴다 - 저장소가 커도 한 번에 받는 데이터가 한 디렉터리 분량뿐이라
// 부담이 훨씬 적다. 엔트리가 많은 디렉터리는 같은 Pagination.vue로
// 30개씩 클라이언트 페이지네이션.
const ENTRIES_PAGE_SIZE = 30;
interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}
const treeDir = ref("");
const treeEntries = ref<TreeEntry[]>([]);
const treeEntriesPage = ref(1);
const treeLoading = ref(false);
const treeError = ref("");

const treeEntriesTotalPages = computed(() => Math.max(1, Math.ceil(treeEntries.value.length / ENTRIES_PAGE_SIZE)));
const pagedTreeEntries = computed(() =>
  treeEntries.value.slice((treeEntriesPage.value - 1) * ENTRIES_PAGE_SIZE, treeEntriesPage.value * ENTRIES_PAGE_SIZE),
);

function parentDir(dirPath: string): string {
  const parts = dirPath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

async function loadTree(dirPath: string) {
  const options = store.options;
  if (!options) return;
  treeLoading.value = true;
  treeError.value = "";
  try {
    treeEntries.value = await apiCall<TreeEntry[]>(`/projects/${options.projectId ?? ""}/git/tree?path=${encodeURIComponent(dirPath)}`);
    treeDir.value = dirPath;
    treeEntriesPage.value = 1;
  } catch (err) {
    treeError.value = err instanceof ApiError ? err.message : "디렉터리를 불러오지 못했습니다";
  } finally {
    treeLoading.value = false;
  }
}

/** multi:false라 클릭 한 번으로 바로 선택 - 기존 "선택됨" 칩/확인
 * 흐름을 그대로 재사용(수동 입력값을 목록에 추가하는 addManual()과는
 * 별개 경로). */
function selectTreeFile(path: string) {
  selected.value = new Set([path]);
}

interface DocumentPage {
  items: DocumentSummary[];
}

// document kind는 프로젝트 문서가 많을 수 있어(#large-list-pagination)
// 전체 배열을 한 번에 안 받는다 - 검색어가 없으면 최근 문서 페이지
// (DocumentsView.vue가 이미 쓰는 라우트), 있으면 Meilisearch 전문검색
// (사이드바 검색과 같은 라우트)로 서버가 직접 추려서 돌려준다.
async function loadDocuments(): Promise<void> {
  const options = store.options;
  if (!options) return;
  const q = search.value.trim();
  if (q) {
    const results = await apiCall<DocumentSummary[]>(`/projects/${options.projectId ?? ""}/search?q=${encodeURIComponent(q)}`);
    items.value = results.map((d) => ({ key: d.trackingCode, label: `${d.trackingCode} · ${d.title}` }));
  } else {
    const page = await apiCall<DocumentPage>(`/projects/${options.projectId ?? ""}/documents/page?page=1&pageSize=50`);
    items.value = page.items.map((d) => ({ key: d.trackingCode, label: `${d.trackingCode} · ${d.title}` }));
  }
}

async function load() {
  const options = store.options;
  if (!options) return;
  loading.value = true;
  error.value = "";
  try {
    if (options.kind === "document") {
      await loadDocuments();
    } else if (options.kind === "user") {
      const users = await apiCall<UserListItem[]>(`/users?limit=100`);
      items.value = users.map((u) => ({ key: u.id, label: u.displayLabel }));
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

// document kind만 검색어 변경 시 서버에 다시 물어본다(디바운스) -
// user/sourceFile은 이미 한 번 받은 목록을 클라이언트에서만 거른다.
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (store.options?.kind !== "document") return;
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loading.value = true;
    loadDocuments()
      .catch((err) => { error.value = err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다"; })
      .finally(() => { loading.value = false; });
  }, 300);
});

watch(
  () => store.open,
  (open) => {
    if (!open) return;
    zIndex.value = nextDialogZIndex();
    search.value = "";
    manualEntry.value = "";
    selected.value = new Set(store.options?.initialSelected ?? []);
    if (store.options?.kind === "sourceFile") {
      treeDir.value = "";
      loadTree("");
    } else {
      load();
    }
  },
);

// document kind는 이미 서버(검색 또는 페이지 조회)가 걸러준 결과라
// 여기서 다시 라벨 문자열로 필터하면 안 된다 - Meilisearch가 본문
// 내용으로 매치시켜준 문서는 추적코드+제목 라벨엔 그 검색어가 없을
// 수 있어, 그대로 필터링하면 방금 서버가 찾아준 결과가 다시 사라진다.
const filteredItems = computed(() => {
  if (store.options?.kind === "document") return items.value;
  const q = search.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((i) => i.label.toLowerCase().includes(q));
});

function toggle(key: string) {
  const opts = store.options;
  if (!opts) return;
  if (opts.multi) {
    const next = new Set(selected.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected.value = next;
  } else {
    selected.value = new Set([key]);
  }
}

function addManual() {
  const value = manualEntry.value.trim();
  if (!value) return;
  const opts = store.options;
  if (opts?.multi) {
    selected.value = new Set([...selected.value, value]);
  } else {
    selected.value = new Set([value]);
  }
  manualEntry.value = "";
}

function confirm() {
  store.confirm([...selected.value]);
}

const kindTitle = computed(() => {
  const k = store.options?.kind;
  if (store.options?.title) return store.options.title;
  if (k === "document") return "문서 선택";
  if (k === "user") return "사용자 선택";
  if (k === "sourceFile") return "소스 파일 선택";
  return "선택";
});
</script>

<template>
  <div v-if="store.open" class="overlay" :style="{ zIndex }" @click.self="store.cancel()">
    <div class="dialog">
      <div class="header">
        <h2>{{ kindTitle }}</h2>
        <button class="close-btn" @click="store.cancel()">닫기 ✕</button>
      </div>
      <template v-if="store.options?.kind === 'sourceFile'">
        <div class="tree-path-bar">
          <button v-if="treeDir" type="button" @click="loadTree(parentDir(treeDir))">.. (상위)</button>
          <span class="tree-current-path">/{{ treeDir }}</span>
        </div>
        <p v-if="treeError" class="error">{{ treeError }}</p>
        <p v-if="treeLoading" class="muted">불러오는 중...</p>
        <ul v-else class="list tree-list">
          <li
            v-for="e in pagedTreeEntries"
            :key="e.path"
            :class="{ dir: e.type === 'dir', active: e.type === 'file' && selected.has(e.path) }"
            @click="e.type === 'dir' ? loadTree(e.path) : selectTreeFile(e.path)"
          >
            <span>{{ e.type === "dir" ? "📁" : "📄" }} {{ e.name }}</span>
          </li>
          <li v-if="treeEntries.length === 0" class="muted empty">파일이 없습니다.</li>
        </ul>
        <Pagination v-if="!treeLoading" :page="treeEntriesPage" :total-pages="treeEntriesTotalPages" @update:page="treeEntriesPage = $event" />
      </template>
      <template v-else>
        <input v-model="search" type="text" class="search" placeholder="검색..." />
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="loading" class="muted">불러오는 중...</p>
        <ul v-else class="list">
          <li v-for="item in filteredItems" :key="item.key" @click="toggle(item.key)">
            <input
              :type="store.options?.multi ? 'checkbox' : 'radio'"
              :checked="selected.has(item.key)"
              @click.stop="toggle(item.key)"
            />
            <span>{{ item.label }}</span>
          </li>
          <li v-if="filteredItems.length === 0" class="muted empty">항목이 없습니다.</li>
        </ul>
      </template>
      <div v-if="store.options?.allowManualEntry" class="manual-row">
        <input v-model="manualEntry" type="text" placeholder="목록에 없으면 직접 입력..." @keydown.enter.prevent="addManual" />
        <button type="button" @click="addManual">추가</button>
      </div>
      <div v-if="selected.size > 0" class="selected-chips">
        <span v-for="key in selected" :key="key" class="chip">{{ key }} <button type="button" @click="toggle(key)">×</button></span>
      </div>
      <div class="actions">
        <button type="button" class="cancel" @click="store.cancel()">취소</button>
        <button type="button" class="confirm" @click="confirm()">확인</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.dialog {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  width: min(520px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.header h2 {
  font-size: 16px;
  margin: 0;
}
.close-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.search {
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  margin-bottom: 10px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  overflow-y: auto;
  flex: 1;
  border: 1px solid #eee;
  border-radius: 8px;
}
.list li {
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #f0f1f5;
  cursor: pointer;
  font-size: 13px;
}
.list li:last-child {
  border-bottom: none;
}
.list li:hover {
  background: #f7f8fb;
}
.list li.empty {
  cursor: default;
}
.list li.empty:hover {
  background: none;
}
.tree-path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.tree-path-bar button {
  font-size: 12px;
  background: #eef0f6;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
}
.tree-current-path {
  font-size: 12px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-list li.dir {
  font-weight: 600;
}
.tree-list li.active {
  background: #e4e9fb;
}
.manual-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.manual-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.manual-row button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 6px 12px;
  border-radius: 6px;
}
.selected-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.chip {
  background: #eef0f6;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.chip button {
  background: none;
  border: none;
  cursor: pointer;
  color: #888;
  font-size: 13px;
  line-height: 1;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.actions .cancel {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 8px 16px;
  border-radius: 6px;
}
.actions .confirm {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
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
