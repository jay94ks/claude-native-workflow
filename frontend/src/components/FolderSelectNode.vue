<script setup lang="ts">
// "문서" 탭 "폴더" 서브탭의 좌측 트리 노드(#documents-tab-redesign) -
// FolderNode.vue(아코디언, 펼치면 그 폴더의 문서를 보여줌)와 달리 이건
// 순수 탐색/선택 전용이다: 이름을 누르면 "선택"만 되고(우측 패널이
// 그 폴더의 문서 목록을 새로 불러옴), caret은 하위 폴더 펼침/접힘만
// 담당한다. 생성/이름변경/삭제/드래그 재배치는 FolderNode.vue와 동일.
import { ref } from "vue";
import draggable from "vuedraggable";
import { apiCall, ApiError } from "../api/client";
import { useConfirmDialogStore } from "../stores/confirmDialog";
import type { SelectableFolderNode } from "../utils/folderTree";

const confirmDialog = useConfirmDialogStore();

defineOptions({ name: "FolderSelectNode" });
const props = defineProps<{ node: SelectableFolderNode; projectId: string; selectedFolderId: string | null }>();
const emit = defineEmits<{ select: [folderId: string]; changed: [error?: string] }>();

const FOLDER_NOT_EMPTY_MESSAGE =
  "비어있지 않은 폴더는 삭제할 수 없습니다 - 재귀 삭제(recursive)나 상위로 끌어올리기(promote) 중 하나를 선택하세요";

function toggleExpand() {
  props.node.expanded = !props.node.expanded;
}
function select() {
  emit("select", props.node.id);
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
async function confirmRecursiveDelete() {
  const confirmed = await confirmDialog.confirm(
    "이 폴더와 모든 하위 폴더, 그 안의 문서 배치가 함께 사라집니다.\n문서 자체는 삭제되지 않습니다(이 폴더에 있다는 정리 정보만 사라짐).\n되돌릴 수 없습니다.",
  );
  if (!confirmed) return;
  removeWithMode("recursive");
}

interface DraggableChangeEvent {
  added?: { element: SelectableFolderNode; newIndex: number };
  moved?: { newIndex: number };
}
function containsId(node: SelectableFolderNode, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((c) => containsId(c as SelectableFolderNode, id));
}
function onMoveCheck(evt: { draggedContext?: { element?: SelectableFolderNode } }): boolean {
  const dragged = evt.draggedContext?.element;
  if (!dragged) return true;
  return !containsId(dragged, props.node.id);
}
async function onChildrenChanged(event: DraggableChangeEvent) {
  if (!event.added && !event.moved) return;
  const folderId = event.added?.element.id ?? (props.node.children[event.moved!.newIndex] as SelectableFolderNode).id;
  const siblingOrder = props.node.children.map((c) => c.id);
  try {
    await apiCall(`/folders/${folderId}`, {
      method: "PUT",
      body: JSON.stringify({ parentFolderId: props.node.id, siblingOrder }),
    });
  } catch (err) {
    emit("changed", err instanceof ApiError ? err.message : "폴더 이동에 실패했습니다");
  }
}
</script>

<template>
  <li class="folder-node">
    <div class="folder-header" :class="{ selected: selectedFolderId === node.id }" @click="select">
      <span class="caret" @click.stop="toggleExpand">{{ node.children.length > 0 ? (node.expanded ? "▾" : "▸") : "" }}</span>
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

    <draggable
      v-if="node.expanded"
      v-model="node.children"
      item-key="id"
      tag="ul"
      class="children"
      group="folder-select-tree"
      handle=".folder-header"
      :animation="150"
      :force-fallback="true"
      ghost-class="drag-ghost"
      :move="onMoveCheck"
      @change="onChildrenChanged"
    >
      <template #item="{ element }">
        <FolderSelectNode
          :node="element"
          :project-id="projectId"
          :selected-folder-id="selectedFolderId"
          @select="(id) => emit('select', id)"
          @changed="(msg) => emit('changed', msg)"
        />
      </template>
    </draggable>
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
.folder-header.selected {
  background: var(--color-primary);
  color: #fff;
}
.folder-header.selected .add-btn,
.folder-header.selected .remove-btn {
  color: rgba(255, 255, 255, 0.8);
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
.folder-header.selected .add-btn:hover,
.folder-header.selected .remove-btn:hover {
  color: #fff;
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
.children {
  list-style: none;
  padding: 0 0 0 18px;
  margin: 0;
}
.drag-ghost {
  opacity: 0.4;
  background: var(--color-surface-hover);
}
</style>
