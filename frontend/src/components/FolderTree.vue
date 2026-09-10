<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ select: [folderId: string | null] }>();

interface FolderItem {
  id: string;
  parentFolderId: string | null;
  name: string;
}
interface Node extends FolderItem {
  children: Node[];
}

const folders = ref<FolderItem[]>([]);
const error = ref("");
const selected = ref<string | null>(null);

const newFolderParent = ref<string | null>(null);
const newFolderName = ref("");
const showNewForm = ref<string | "root" | null>(null);

const renamingId = ref<string | null>(null);
const renameDraft = ref("");

const tree = computed<Node[]>(() => {
  const byParent = new Map<string | null, Node[]>();
  const nodes: Node[] = folders.value.map((f) => ({ ...f, children: [] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const list = byParent.get(n.parentFolderId) ?? [];
    list.push(n);
    byParent.set(n.parentFolderId, list);
  }
  for (const n of nodes) n.children = byParent.get(n.id) ?? [];
  return byParent.get(null) ?? [];
  // byId는 트리 조립용 임시 참조 - 사용하지 않는 경고 방지 목적으로 아래 한 줄
  void byId;
});

async function load() {
  error.value = "";
  try {
    folders.value = await apiCall<FolderItem[]>(`/projects/${props.projectId}/folders`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 목록을 불러오지 못했습니다";
  }
}

function select(id: string | null) {
  selected.value = id;
  emit("select", id);
}

function openNewForm(parentId: string | "root") {
  showNewForm.value = parentId;
  newFolderParent.value = parentId === "root" ? null : parentId;
  newFolderName.value = "";
}

async function createFolder() {
  if (!newFolderName.value.trim()) return;
  error.value = "";
  try {
    await apiCall(`/projects/${props.projectId}/folders`, {
      method: "POST",
      body: JSON.stringify({ name: newFolderName.value.trim(), parentFolderId: newFolderParent.value ?? undefined }),
    });
    showNewForm.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 생성에 실패했습니다";
  }
}

function startRename(node: Node) {
  renamingId.value = node.id;
  renameDraft.value = node.name;
}

async function rename() {
  if (!renamingId.value || !renameDraft.value.trim()) return;
  error.value = "";
  try {
    await apiCall(`/folders/${renamingId.value}`, { method: "PUT", body: JSON.stringify({ name: renameDraft.value.trim() }) });
    renamingId.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "이름 변경에 실패했습니다";
  }
}

async function remove(id: string) {
  error.value = "";
  try {
    await apiCall(`/folders/${id}`, { method: "DELETE" });
    if (selected.value === id) select(null);
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다(비어있지 않은 폴더일 수 있음)";
  }
}

onMounted(load);
</script>

<template>
  <div class="tree">
    <p v-if="error" class="error">{{ error }}</p>
    <div class="node root" :class="{ active: selected === null }" @click="select(null)">
      <span>(폴더 없음 - 전체 문서)</span>
      <button class="add-btn" @click.stop="openNewForm('root')">+</button>
    </div>
    <form v-if="showNewForm === 'root'" class="new-form" @submit.prevent="createFolder">
      <input v-model="newFolderName" type="text" placeholder="폴더 이름" />
      <button type="submit">생성</button>
    </form>

    <ul class="children">
      <template v-for="node in tree" :key="node.id">
        <li>
          <div class="node" :class="{ active: selected === node.id }" @click="select(node.id)" @dblclick="startRename(node)">
            <template v-if="renamingId === node.id">
              <input v-model="renameDraft" type="text" class="rename-input" @click.stop @keyup.enter="rename" />
              <button class="add-btn" @click.stop="rename">저장</button>
            </template>
            <template v-else>
              <span>{{ node.name }}</span>
              <button class="add-btn" @click.stop="openNewForm(node.id)">+</button>
              <button class="remove-btn" @click.stop="remove(node.id)">삭제</button>
            </template>
          </div>
          <form v-if="showNewForm === node.id" class="new-form" @submit.prevent="createFolder">
            <input v-model="newFolderName" type="text" placeholder="하위 폴더 이름" />
            <button type="submit">생성</button>
          </form>
          <ul v-if="node.children.length > 0" class="children nested">
            <li v-for="child in node.children" :key="child.id">
              <div class="node" :class="{ active: selected === child.id }" @click="select(child.id)">
                <span>{{ child.name }}</span>
              </div>
            </li>
          </ul>
        </li>
      </template>
    </ul>
  </div>
</template>

<style scoped>
.tree {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px;
  min-width: 200px;
}
.node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.node:hover {
  background: #f8f9fb;
}
.node.active {
  background: #e4e9fb;
  color: #3454d1;
  font-weight: 600;
}
.node span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add-btn,
.remove-btn {
  background: none;
  border: none;
  color: #999;
  font-size: 12px;
  flex-shrink: 0;
}
.add-btn:hover,
.remove-btn:hover {
  color: #3454d1;
}
.children {
  list-style: none;
  padding: 0 0 0 12px;
  margin: 0;
}
.children.nested {
  padding-left: 16px;
}
.new-form {
  display: flex;
  gap: 4px;
  padding: 4px 8px 8px;
}
.new-form input {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid #d8dae0;
  border-radius: 4px;
  font-size: 12px;
}
.new-form button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.rename-input {
  padding: 3px 6px;
  border: 1px solid #d8dae0;
  border-radius: 4px;
  font-size: 12px;
  flex: 1;
}
.error {
  color: #d1344b;
  font-size: 12px;
}
</style>
