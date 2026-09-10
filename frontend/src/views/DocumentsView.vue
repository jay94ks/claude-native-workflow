<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ id: string }>();
const router = useRouter();

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

const documents = ref<DocumentSummary[]>([]);
const docTypes = ref<DocType[]>([]);
const filterTypeId = ref("");
const loading = ref(true);
const error = ref("");

function docTypeLabel(id: string): string {
  const t = docTypes.value.find((dt) => dt.id === id);
  return t ? `${t.code} · ${t.label}` : id;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    docTypes.value = await apiCall<DocType[]>(`/projects/${props.id}/doc-types`);
    const qs = filterTypeId.value ? `?docTypeId=${filterTypeId.value}` : "";
    documents.value = await apiCall<DocumentSummary[]>(`/projects/${props.id}/documents${qs}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
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

onMounted(load);
watch(filterTypeId, load);
</script>

<template>
  <div class="filter-row">
    <select v-model="filterTypeId">
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

  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="doc in documents" :key="doc.trackingCode">
      <router-link :to="`/projects/${id}/documents/${doc.trackingCode}`">
        <code>{{ doc.trackingCode }}</code> {{ doc.title }}
      </router-link>
      <span class="muted">{{ docTypeLabel(doc.docTypeId) }} · {{ doc.statusCode }}</span>
    </li>
    <li v-if="documents.length === 0" class="muted">문서가 없습니다.</li>
  </ul>
</template>

<style scoped>
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
