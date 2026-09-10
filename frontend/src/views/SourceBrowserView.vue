<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import MonacoEditor from "../components/MonacoEditor.vue";
import { languageForPath } from "../utils/language";

const props = defineProps<{ id: string }>();

interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}
interface GitRepo {
  provider: string;
  repoUrl: string;
}

const hasRepo = ref<boolean | null>(null);
const currentDir = ref("");
const entries = ref<TreeEntry[]>([]);
const treeError = ref("");
const treeLoading = ref(true);

const selectedPath = ref("");
const fileContent = ref("");
const fileError = ref("");
const fileLoading = ref(false);
const saving = ref(false);
const saveMessage = ref("");

const newFilePath = ref("");

async function checkRepo() {
  try {
    await apiCall<GitRepo>(`/projects/${props.id}/git/repo`);
    hasRepo.value = true;
  } catch {
    hasRepo.value = false;
  }
}

async function loadTree(dirPath: string) {
  treeLoading.value = true;
  treeError.value = "";
  try {
    entries.value = await apiCall<TreeEntry[]>(`/projects/${props.id}/git/tree?path=${encodeURIComponent(dirPath)}`);
    currentDir.value = dirPath;
  } catch (err) {
    treeError.value = err instanceof ApiError ? err.message : "디렉터리를 불러오지 못했습니다";
  } finally {
    treeLoading.value = false;
  }
}

function parentDir(dirPath: string): string {
  const parts = dirPath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

async function openEntry(entry: TreeEntry) {
  if (entry.type === "dir") {
    await loadTree(entry.path);
    return;
  }
  fileLoading.value = true;
  fileError.value = "";
  saveMessage.value = "";
  try {
    const file = await apiCall<{ content: string }>(`/projects/${props.id}/git/file?path=${encodeURIComponent(entry.path)}`);
    selectedPath.value = entry.path;
    fileContent.value = file.content;
  } catch (err) {
    fileError.value = err instanceof ApiError ? err.message : "파일을 불러오지 못했습니다";
  } finally {
    fileLoading.value = false;
  }
}

function openNewFile() {
  const path = newFilePath.value.trim();
  if (!path) return;
  selectedPath.value = path;
  fileContent.value = "";
  fileError.value = "";
  saveMessage.value = "";
  newFilePath.value = "";
}

async function save() {
  if (!selectedPath.value) return;
  saving.value = true;
  saveMessage.value = "";
  fileError.value = "";
  try {
    await apiCall(`/projects/${props.id}/git/file?path=${encodeURIComponent(selectedPath.value)}`, {
      method: "PUT",
      body: JSON.stringify({ content: fileContent.value, message: `docs: update ${selectedPath.value}` }),
    });
    saveMessage.value = "커밋됨";
    if (currentDir.value === parentDir(selectedPath.value)) await loadTree(currentDir.value);
  } catch (err) {
    fileError.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await checkRepo();
  if (hasRepo.value) await loadTree("");
});
</script>

<template>
  <h1>소스 코드</h1>
  <p v-if="hasRepo === false" class="muted">
    연결된 git 저장소가 없습니다 - 프로젝트 상세 화면에서 <code>docs git link</code>로 먼저 연결하세요.
  </p>
  <div v-else-if="hasRepo" class="layout">
    <aside class="tree">
      <div class="path-bar">
        <button v-if="currentDir" @click="loadTree(parentDir(currentDir))">.. (상위)</button>
        <span class="current-path">/{{ currentDir }}</span>
      </div>
      <p v-if="treeError" class="error">{{ treeError }}</p>
      <p v-if="treeLoading">불러오는 중...</p>
      <ul v-else class="entries">
        <li v-for="e in entries" :key="e.path" :class="{ dir: e.type === 'dir', active: e.path === selectedPath }" @click="openEntry(e)">
          {{ e.type === "dir" ? "📁" : "📄" }} {{ e.name }}
        </li>
      </ul>
      <form class="new-file" @submit.prevent="openNewFile">
        <input v-model="newFilePath" type="text" placeholder="새 파일 경로(예: docs/note.md)" />
        <button type="submit">열기</button>
      </form>
    </aside>
    <section class="editor-pane">
      <template v-if="selectedPath">
        <div class="editor-header">
          <code>{{ selectedPath }}</code>
          <button :disabled="saving" @click="save">{{ saving ? "저장 중..." : "저장(커밋)" }}</button>
        </div>
        <p v-if="fileError" class="error">{{ fileError }}</p>
        <p v-if="saveMessage" class="saved">{{ saveMessage }}</p>
        <p v-if="fileLoading">불러오는 중...</p>
        <MonacoEditor v-else v-model="fileContent" :language="languageForPath(selectedPath)" class="editor" />
      </template>
      <p v-else class="muted">왼쪽에서 파일을 선택하세요.</p>
    </section>
  </div>
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 16px;
}
.layout {
  display: flex;
  gap: 16px;
  height: calc(100vh - 140px);
}
.tree {
  width: 260px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.path-bar button {
  font-size: 12px;
  background: #eef0f6;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
}
.current-path {
  font-size: 12px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entries {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
}
.entries li {
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.entries li:hover {
  background: #f0f1f5;
}
.entries li.active {
  background: #e4e9fb;
}
.new-file {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.new-file input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 12px;
}
.new-file button {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #d8dae0;
  background: #fff;
}
.editor-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.editor-header code {
  font-size: 12px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
}
.editor-header button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
}
.editor-header button:disabled {
  opacity: 0.6;
}
.editor {
  flex: 1;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
.saved {
  color: #1f9254;
  font-size: 13px;
}
</style>
