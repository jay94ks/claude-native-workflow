<script setup lang="ts">
// 재귀 컴포넌트 하나가 폴더 하나를 그린다 - 이름/드래그 핸들/이름
// 변경/하위 폴더 생성/삭제(재귀삭제·상위끌어올리기 선택) 버튼과,
// 펼치면 그 폴더의 문서(지연 로드)+자식 폴더 목록을 보여준다.
// 자식 폴더 목록은 <draggable>로 감싸 재귀 호출하며, group을 트리의
// 모든 재귀 인스턴스가 공유해 다른 부모로도 드래그 이동이 가능하다
// (#kanban-touch-dnd 라운드와 동일한 group 공유 패턴).
import { ref } from "vue";
import draggable from "vuedraggable";
import { apiCall, ApiError } from "../api/client";
import type { EditableFolderNode, FolderDocumentSummary } from "../utils/folderTree";

defineOptions({ name: "FolderNode" });
const props = defineProps<{ node: EditableFolderNode; projectId: string; filterTypeId?: string }>();
const emit = defineEmits<{ changed: [error?: string]; docMoveFailed: [error: string] }>();

// 문서 유형 필터는 draggable의 v-model 배열 자체를 거르지 않는다 -
// 거르면 화면에 보이는 인덱스와 실제 배열 인덱스가 어긋나 드래그
// 계산이 틀어진다. 대신 각 행을 v-show로만 숨겨 배열/드래그 순서는
// 그대로 두고 화면에만 반영한다.
function matchesFilter(d: FolderDocumentSummary): boolean {
  return !props.filterTypeId || d.docTypeId === props.filterTypeId;
}

// core/folders.ts의 FOLDER_NOT_EMPTY_MESSAGE와 정확히 같은 문자열이어야
// 한다(기존 FolderTree.vue와 동일한 관례) - 백엔드 메시지를 바꾸면
// 이쪽도 같이 바꿔야 함.
const FOLDER_NOT_EMPTY_MESSAGE =
  "비어있지 않은 폴더는 삭제할 수 없습니다 - 재귀 삭제(recursive)나 상위로 끌어올리기(promote) 중 하나를 선택하세요";

async function toggleExpand() {
  props.node.expanded = !props.node.expanded;
  if (props.node.expanded && !props.node.docsLoaded && !props.node.loadingDocs) {
    props.node.loadingDocs = true;
    props.node.docsError = "";
    try {
      props.node.documents = await apiCall<FolderDocumentSummary[]>(`/folders/${props.node.id}/documents`);
      props.node.docsLoaded = true;
    } catch (err) {
      props.node.docsError = err instanceof ApiError ? err.message : "문서를 불러오지 못했습니다";
      props.node.documents = [];
    } finally {
      props.node.loadingDocs = false;
    }
  }
}

const renaming = ref(false);
const renameDraft = ref("");
function startRename() {
  renaming.value = true;
  renameDraft.value = props.node.name;
}
async function rename() {
  if (!renameDraft.value.trim()) return;
  try {
    await apiCall(`/folders/${props.node.id}`, { method: "PUT", body: JSON.stringify({ name: renameDraft.value.trim() }) });
    renaming.value = false;
    emit("changed");
  } catch (err) {
    emit("changed", err instanceof ApiError ? err.message : "이름 변경에 실패했습니다");
  }
}

const showChildForm = ref(false);
const newChildName = ref("");
function openChildForm() {
  props.node.expanded = true;
  showChildForm.value = true;
  newChildName.value = "";
}
async function createChild() {
  if (!newChildName.value.trim()) return;
  try {
    await apiCall(`/projects/${props.projectId}/folders`, {
      method: "POST",
      body: JSON.stringify({ name: newChildName.value.trim(), parentFolderId: props.node.id }),
    });
    showChildForm.value = false;
    emit("changed");
  } catch (err) {
    emit("changed", err instanceof ApiError ? err.message : "폴더 생성에 실패했습니다");
  }
}

const pendingDeleteChoice = ref(false);
async function remove() {
  try {
    await apiCall(`/folders/${props.node.id}`, { method: "DELETE" });
    emit("changed");
  } catch (err) {
    if (err instanceof ApiError && err.message === FOLDER_NOT_EMPTY_MESSAGE) {
      pendingDeleteChoice.value = true;
      return;
    }
    emit("changed", err instanceof ApiError ? err.message : "삭제에 실패했습니다");
  }
}
async function removeWithMode(mode: "recursive" | "promote") {
  pendingDeleteChoice.value = false;
  try {
    await apiCall(`/folders/${props.node.id}?mode=${mode}`, { method: "DELETE" });
    emit("changed");
  } catch (err) {
    emit("changed", err instanceof ApiError ? err.message : "삭제에 실패했습니다");
  }
}
function confirmRecursiveDelete() {
  const confirmed = window.confirm(
    "이 폴더와 모든 하위 폴더, 그 안의 문서 배치가 함께 사라집니다.\n문서 자체는 삭제되지 않습니다(이 폴더에 있다는 정리 정보만 사라짐).\n되돌릴 수 없습니다.",
  );
  if (!confirmed) return;
  removeWithMode("recursive");
}

interface DraggableChangeEvent {
  added?: { element: EditableFolderNode; newIndex: number };
  moved?: { newIndex: number };
}

// 드래그 중인 폴더가 자기 자신의 하위 트리 위로 올라가려는지 즉시
// 판정하는 클라이언트 쪽 1차 방어 - 서버의 isDescendantOf가 최종
// 방어선이지만, 여기서 먼저 막아야 드래그 도중 "안 됨" 표시가 바로
// 보인다. 이 목록(this.node.children)의 소유 폴더 자신(props.node)이
// 곧 드롭 대상 부모이므로, dragged 폴더의 하위 트리 안에 props.node.id
// 가 있으면(자기 자신 포함) 거부한다.
function containsId(node: EditableFolderNode, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((c) => containsId(c as EditableFolderNode, id));
}
function onMoveCheck(evt: { draggedContext?: { element?: EditableFolderNode } }): boolean {
  const dragged = evt.draggedContext?.element;
  if (!dragged) return true;
  return !containsId(dragged, props.node.id);
}

async function onChildrenChanged(event: DraggableChangeEvent) {
  if (!event.added && !event.moved) return;
  const folderId = event.added?.element.id ?? (props.node.children[event.moved!.newIndex] as EditableFolderNode).id;
  const siblingOrder = props.node.children.map((c) => c.id);
  try {
    await apiCall(`/folders/${folderId}`, {
      method: "PUT",
      body: JSON.stringify({ parentFolderId: props.node.id, siblingOrder }),
    });
    // 성공 - vuedraggable이 이미 로컬 트리를 옮겨뒀으므로 그대로 둔다
    // (개인 폴더 트리라 동시 충돌 위험이 낮음 - #kanban-touch-dnd와
    // 다르게 매번 재조회하지 않는다).
  } catch (err) {
    emit("changed", err instanceof ApiError ? err.message : "폴더 이동에 실패했습니다");
  }
}

interface DocDraggableChangeEvent {
  added?: { element: FolderDocumentSummary; newIndex: number };
}

// 문서 드래그는 폴더 배정만 바꾼다(DocumentFolderEntry에 순서 개념이
// 없어 같은 목록 안 재정렬(moved)은 할 일이 없다 - added만 반응,
// removed는 반대쪽 목록의 added가 이미 처리).
async function onDocumentsChanged(event: DocDraggableChangeEvent) {
  if (!event.added) return;
  const trackingCode = event.added.element.trackingCode;
  try {
    await apiCall(`/documents/${trackingCode}/folder`, {
      method: "PUT",
      body: JSON.stringify({ folderId: props.node.id }),
    });
  } catch (err) {
    emit("docMoveFailed", err instanceof ApiError ? err.message : "문서 폴더 이동에 실패했습니다");
  }
}
</script>

<template>
  <li class="folder-node">
    <div class="folder-header" @click="toggleExpand">
      <span class="caret">{{ node.expanded ? "▾" : "▸" }}</span>
      <template v-if="renaming">
        <input v-model="renameDraft" type="text" class="rename-input" @click.stop @keyup.enter="rename" />
        <button class="add-btn" @click.stop="rename">저장</button>
      </template>
      <template v-else>
        <span class="name" @dblclick.stop="startRename">📁 {{ node.name }}</span>
        <button class="add-btn" @click.stop="openChildForm">+</button>
        <button class="remove-btn" @click.stop="remove">삭제</button>
      </template>
    </div>

    <div v-if="pendingDeleteChoice" class="delete-choice" @click.stop>
      <span class="delete-choice-label">비어있지 않음:</span>
      <button class="choice-btn danger" @click="confirmRecursiveDelete">재귀 삭제</button>
      <button class="choice-btn" @click="removeWithMode('promote')">상위로 끌어올리기</button>
      <button class="choice-btn" @click="pendingDeleteChoice = false">취소</button>
    </div>
    <form v-if="showChildForm" class="new-form" @submit.prevent="createChild" @click.stop>
      <input v-model="newChildName" type="text" placeholder="하위 폴더 이름" />
      <button type="submit">생성</button>
    </form>

    <template v-if="node.expanded">
      <p v-if="node.loadingDocs" class="muted doc-status">불러오는 중...</p>
      <p v-if="node.docsError" class="error doc-status">{{ node.docsError }}</p>
      <draggable
        v-model="node.documents"
        item-key="trackingCode"
        tag="ul"
        class="doc-list"
        group="tree-documents"
        :animation="150"
        :force-fallback="true"
        ghost-class="drag-ghost"
        :delay="150"
        :delay-on-touch-only="true"
        @change="onDocumentsChanged"
      >
        <template #item="{ element: d }">
          <li v-show="matchesFilter(d)">
            <router-link :to="`/projects/${projectId}/documents/${d.trackingCode}`">
              <code>{{ d.trackingCode }}</code> {{ d.title }}
            </router-link>
          </li>
        </template>
      </draggable>
      <p
        v-if="node.docsLoaded && node.documents.length === 0 && !node.loadingDocs && node.children.length === 0"
        class="muted empty doc-status"
      >
        문서 없음
      </p>
      <draggable
        v-model="node.children"
        item-key="id"
        tag="ul"
        class="children"
        group="folder-tree"
        handle=".folder-header"
        :animation="150"
        :force-fallback="true"
        ghost-class="drag-ghost"
        :move="onMoveCheck"
        @change="onChildrenChanged"
      >
        <template #item="{ element }">
          <FolderNode
            :node="element"
            :project-id="projectId"
            :filter-type-id="filterTypeId"
            @changed="(msg) => emit('changed', msg)"
            @doc-move-failed="(msg) => emit('docMoveFailed', msg)"
          />
        </template>
      </draggable>
    </template>
  </li>
</template>

<style scoped>
.folder-node {
  list-style: none;
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
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add-btn,
.remove-btn {
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: 12px;
  flex-shrink: 0;
}
.add-btn:hover,
.remove-btn:hover {
  color: var(--color-primary);
}
.rename-input {
  flex: 1;
  padding: 3px 6px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
  user-select: text;
}
.delete-choice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 8px 26px;
}
.delete-choice-label {
  font-size: 11px;
  color: var(--color-danger);
}
.choice-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.choice-btn.danger {
  border-color: var(--color-danger-border-strong);
  color: var(--color-danger);
}
.new-form {
  display: flex;
  gap: 4px;
  padding: 4px 8px 8px 26px;
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
.doc-status {
  margin: 0;
  padding: 3px 6px 3px 26px;
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
.children {
  list-style: none;
  padding: 0 0 0 18px;
  margin: 0;
}
.drag-ghost {
  opacity: 0.4;
  background: var(--color-surface-hover);
}
.muted {
  color: var(--color-text-muted);
  font-size: 12px;
}
.error {
  color: var(--color-danger);
  font-size: 12px;
}
</style>
