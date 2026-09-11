<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import FolderTree from "../components/FolderTree.vue";

const props = defineProps<{ id: string }>();
const router = useRouter();
const route = useRoute();
const isRecentMode = computed(() => route.query.recent === "1");

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

const documents = ref<DocumentSummary[]>([]);
const docTypes = ref<DocType[]>([]);
const filterTypeId = ref("");
const loading = ref(true);
const error = ref("");
const selectedFolderId = ref<string | null>(null);
const moveError = ref("");

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
    } else if (selectedFolderId.value) {
      // 폴더 전용 목록은 상태 코드를 안 담고 있어 표시용으로 "-"를 채운다
      // (폴더는 DB 전용 정리 기능이라 검색 인덱스를 안 거치는 별도 경로).
      const folderDocs = await apiCall<FolderDocument[]>(`/folders/${selectedFolderId.value}/documents`);
      documents.value = folderDocs.map((d) => ({ ...d, statusCode: "-" }));
    } else {
      const qs = filterTypeId.value ? `?docTypeId=${filterTypeId.value}` : "";
      documents.value = await apiCall<DocumentSummary[]>(`/projects/${props.id}/documents${qs}`);
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function onFolderSelect(folderId: string | null) {
  selectedFolderId.value = folderId;
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
watch(filterTypeId, load);
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

        <form class="create-row" @submit.prevent="create">
          <input v-model="newTitle" type="text" placeholder="새 문서 제목" />
          <select v-model="newTypeCode">
            <option v-for="t in docTypes" :key="t.id" :value="t.code">{{ t.code }}</option>
          </select>
          <button type="submit">만들기</button>
        </form>
        <p v-if="selectedTypeGuideline" class="guideline-hint">{{ selectedTypeGuideline }}</p>
      </template>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="moveError" class="error">{{ moveError }}</p>
      <p v-if="loading">불러오는 중...</p>
      <ul v-else class="list">
        <li v-for="doc in documents" :key="doc.trackingCode">
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
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
}
.move-select {
  padding: 4px 6px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 11px;
}
.recent-heading {
  font-size: 15px;
  margin: 0 0 12px;
}
.filter-row {
  margin-bottom: 12px;
}
.filter-row select {
  padding: 6px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.create-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.create-row select {
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.create-row button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.guideline-hint {
  font-size: 12px;
  color: #888;
  margin: -12px 0 16px;
}
.list {
  list-style: none;
  padding: 0;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.list li:last-child {
  border-bottom: none;
}
.list code {
  font-size: 12px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 6px;
}
.muted {
  color: #888;
  font-size: 13px;
  white-space: nowrap;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
