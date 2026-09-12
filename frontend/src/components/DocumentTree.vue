<script setup lang="ts">
// "문서" 탭의 폴더 트리 - 맨 위에 가상 "최상위 폴더" 노드(어느
// 폴더에도 안 담긴 문서들), 그 아래 설계자 개인 폴더 트리(재귀
// 컴포넌트 FolderNode.vue, 드래그로 재배치 가능). 문서 자체도
// FolderNode.vue/이 컴포넌트의 문서 목록 안에서 드래그하면 그 폴더로
// 옮겨진다(group="tree-documents" 공유).
import { onMounted, ref } from "vue";
import draggable from "vuedraggable";
import { apiCall, ApiError } from "../api/client";
import {
  buildFolderTree,
  type AugmentedFolder,
  type EditableFolderNode,
  type FolderDocumentSummary,
  type FolderItem,
  type FolderUiState,
} from "../utils/folderTree";
import FolderNode from "./FolderNode.vue";

const props = defineProps<{ projectId: string }>();

interface DocType {
  id: string;
  code: string;
  label: string;
}
const docTypes = ref<DocType[]>([]);
const filterTypeId = ref("");
async function loadDocTypes() {
  try {
    docTypes.value = await apiCall<DocType[]>(`/projects/${props.projectId}/doc-types`);
  } catch {
    docTypes.value = [];
  }
}
function matchesFilter(d: FolderDocumentSummary): boolean {
  return !filterTypeId.value || d.docTypeId === filterTypeId.value;
}

const rootFolders = ref<EditableFolderNode[]>([]);
const loading = ref(true);
const error = ref("");

const showRootForm = ref(false);
const newRootName = ref("");

// ---------------------------------------------------------------- 가상 "최상위 폴더" (미분류 문서)
const unfiledExpanded = ref(false);
const unfiledDocuments = ref<FolderDocumentSummary[]>([]);
const unfiledLoaded = ref(false);
const unfiledLoading = ref(false);
const unfiledError = ref("");

async function toggleUnfiled() {
  unfiledExpanded.value = !unfiledExpanded.value;
  if (unfiledExpanded.value && !unfiledLoaded.value && !unfiledLoading.value) {
    await loadUnfiled();
  }
}
async function loadUnfiled() {
  unfiledLoading.value = true;
  unfiledError.value = "";
  try {
    unfiledDocuments.value = await apiCall<FolderDocumentSummary[]>(`/projects/${props.projectId}/documents/unfiled`);
    unfiledLoaded.value = true;
  } catch (err) {
    unfiledError.value = err instanceof ApiError ? err.message : "문서를 불러오지 못했습니다";
    unfiledDocuments.value = [];
  } finally {
    unfiledLoading.value = false;
  }
}

interface DocDraggableChangeEvent {
  added?: { element: FolderDocumentSummary; newIndex: number };
}
async function onUnfiledChanged(event: DocDraggableChangeEvent) {
  if (!event.added) return;
  const trackingCode = event.added.element.trackingCode;
  try {
    await apiCall(`/documents/${trackingCode}/folder`, { method: "PUT", body: JSON.stringify({ folderId: null }) });
  } catch (err) {
    onDocMoveFailed(err instanceof ApiError ? err.message : "문서 폴더 이동에 실패했습니다");
  }
}

// 문서 드래그가 실패하면(네트워크 오류 등) 이미 vuedraggable이 로컬
// 목록을 옮겨둔 상태라 화면과 서버가 어긋난다 - 지금까지 펼쳐서 한 번
// 이상 불러온 목록(가상 노드 포함)만 전부 다시 불러와 되돌린다(폴더
// 구조 자체는 안 바뀌었으니 rootFolders를 통째로 다시 조립할 필요는
// 없음).
function collectLoadedFolderNodes(nodes: EditableFolderNode[], out: EditableFolderNode[]) {
  for (const n of nodes) {
    if (n.docsLoaded) out.push(n);
    collectLoadedFolderNodes(n.children as EditableFolderNode[], out);
  }
}
async function onDocMoveFailed(msg: string) {
  error.value = msg;
  if (unfiledLoaded.value) await loadUnfiled();
  const loadedNodes: EditableFolderNode[] = [];
  collectLoadedFolderNodes(rootFolders.value, loadedNodes);
  await Promise.all(
    loadedNodes.map(async (n) => {
      try {
        n.documents = await apiCall<FolderDocumentSummary[]>(`/folders/${n.id}/documents`);
      } catch {
        // 개별 폴더 재조회 실패는 무시 - 다음에 펼칠 때 다시 시도됨
      }
    }),
  );
}

// ---------------------------------------------------------------- 실제 폴더 트리

function collectUiState(nodes: EditableFolderNode[], map: Map<string, FolderUiState>) {
  for (const n of nodes) {
    map.set(n.id, { expanded: n.expanded, documents: n.documents, docsLoaded: n.docsLoaded, loadingDocs: false, docsError: n.docsError });
    collectUiState(n.children as EditableFolderNode[], map);
  }
}

// 폴더 구조가 바뀌는 작업(생성/이름변경/삭제/드래그 실패 복구) 뒤엔
// 항상 이 함수로 다시 불러온다 - 이때 펼쳐 둔 폴더/이미 불러온 문서
// 목록(FolderUiState)은 id로 매칭해 새 트리에 그대로 옮겨 붙인다.
// preserve=false는 최초 마운트 때만 - 보존할 이전 상태 자체가 없다.
async function load(preserve = true) {
  loading.value = true;
  error.value = "";
  const prevState = new Map<string, FolderUiState>();
  if (preserve) collectUiState(rootFolders.value, prevState);
  try {
    const flat = await apiCall<FolderItem[]>(`/projects/${props.projectId}/folders`);
    const augmented: AugmentedFolder[] = flat.map((f) => {
      const prev = prevState.get(f.id);
      return {
        ...f,
        expanded: prev?.expanded ?? false,
        documents: prev?.documents ?? [],
        docsLoaded: prev?.docsLoaded ?? false,
        loadingDocs: false,
        docsError: prev?.docsError ?? "",
      };
    });
    rootFolders.value = buildFolderTree(augmented) as EditableFolderNode[];
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function onChanged(msg?: string) {
  if (msg) error.value = msg;
  load();
}

function openRootForm() {
  showRootForm.value = true;
  newRootName.value = "";
}
async function createRootFolder() {
  if (!newRootName.value.trim()) return;
  error.value = "";
  try {
    await apiCall(`/projects/${props.projectId}/folders`, {
      method: "POST",
      body: JSON.stringify({ name: newRootName.value.trim() }),
    });
    showRootForm.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 생성에 실패했습니다";
  }
}

interface DraggableChangeEvent {
  added?: { element: EditableFolderNode; newIndex: number };
  moved?: { newIndex: number };
}
async function onRootChanged(event: DraggableChangeEvent) {
  if (!event.added && !event.moved) return;
  const folderId = event.added?.element.id ?? rootFolders.value[event.moved!.newIndex].id;
  const siblingOrder = rootFolders.value.map((f) => f.id);
  try {
    await apiCall(`/folders/${folderId}`, {
      method: "PUT",
      body: JSON.stringify({ parentFolderId: null, siblingOrder }),
    });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 이동에 실패했습니다";
    await load();
  }
}

onMounted(() => {
  loadDocTypes();
  load(false);
});
</script>

<template>
  <div class="doc-tree">
    <div class="tree-toolbar">
      <select v-model="filterTypeId">
        <option value="">전체 타입</option>
        <option v-for="t in docTypes" :key="t.id" :value="t.id">{{ t.code }} · {{ t.label }}</option>
      </select>
      <span class="spacer"></span>
      <button class="new-root-btn" @click="openRootForm">+ 새 폴더</button>
    </div>
    <form v-if="showRootForm" class="new-form" @submit.prevent="createRootFolder">
      <input v-model="newRootName" type="text" placeholder="폴더 이름" />
      <button type="submit">생성</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>

    <ul class="root-children">
      <li class="folder-node">
        <div class="folder-header" @click="toggleUnfiled">
          <span class="caret">{{ unfiledExpanded ? "▾" : "▸" }}</span>
          <span class="name">📂 (미분류 문서)</span>
        </div>
        <template v-if="unfiledExpanded">
          <p v-if="unfiledLoading" class="muted doc-status">불러오는 중...</p>
          <p v-if="unfiledError" class="error doc-status">{{ unfiledError }}</p>
          <draggable
            v-model="unfiledDocuments"
            item-key="trackingCode"
            tag="ul"
            class="doc-list"
            group="tree-documents"
            :animation="150"
            :force-fallback="true"
            ghost-class="drag-ghost"
            :delay="150"
            :delay-on-touch-only="true"
            @change="onUnfiledChanged"
          >
            <template #item="{ element: d }">
              <li v-show="matchesFilter(d)">
                <router-link :to="`/projects/${projectId}/documents/${d.trackingCode}`">
                  <code>{{ d.trackingCode }}</code> {{ d.title }}
                </router-link>
              </li>
            </template>
          </draggable>
          <p v-if="unfiledLoaded && unfiledDocuments.length === 0 && !unfiledLoading" class="muted empty doc-status">문서 없음</p>
        </template>
      </li>
    </ul>

    <p v-if="loading" class="muted">불러오는 중...</p>
    <draggable
      v-else
      v-model="rootFolders"
      item-key="id"
      tag="ul"
      class="root-children"
      group="folder-tree"
      handle=".folder-header"
      :animation="150"
      :force-fallback="true"
      ghost-class="drag-ghost"
      @change="onRootChanged"
    >
      <template #item="{ element }">
        <FolderNode
          :node="element"
          :project-id="projectId"
          :filter-type-id="filterTypeId"
          @changed="onChanged"
          @doc-move-failed="onDocMoveFailed"
        />
      </template>
    </draggable>
    <p v-if="!loading && rootFolders.length === 0" class="muted">폴더가 없습니다.</p>
  </div>
</template>

<style scoped>
.doc-tree {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px;
  /* 트리 전체를 드래그(폴더/문서 재배치)할 때 텍스트가 같이 선택되는
     걸 막는다 - 하위(FolderNode.vue 포함)에 그대로 상속됨. 입력
     필드는 아래에서 개별적으로 복원. */
  user-select: none;
}
.folder-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.folder-header:hover {
  background: var(--color-surface-hover);
}
.caret {
  width: 12px;
  flex-shrink: 0;
  color: var(--color-text-faint);
  font-size: 11px;
}
.tree-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 0 10px;
}
.tree-toolbar select {
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
}
.spacer {
  flex: 1;
}
.new-root-btn {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}
.new-form {
  display: flex;
  gap: 4px;
  padding: 4px 8px 8px;
}
.new-form input {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
  user-select: text;
}
.new-form button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.root-children {
  list-style: none;
  padding: 0;
  margin: 0;
}
.doc-list {
  list-style: none;
  margin: 0;
  padding: 0 0 2px 26px;
}
.doc-list li {
  padding: 3px 6px;
  font-size: 12px;
}
.doc-list a {
  color: var(--color-text);
  text-decoration: none;
}
.doc-list a:hover {
  color: var(--color-primary);
}
.doc-list code {
  font-size: 11px;
  background: var(--color-surface-hover);
  padding: 1px 5px;
  border-radius: 4px;
  margin-right: 4px;
}
.doc-list .empty {
  color: var(--color-text-muted);
}
.drag-ghost {
  opacity: 0.4;
  background: var(--color-surface-hover);
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
  padding: 4px 8px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
  padding: 4px 8px;
}
.doc-status {
  margin: 0;
  padding: 3px 6px 3px 26px;
}
</style>
