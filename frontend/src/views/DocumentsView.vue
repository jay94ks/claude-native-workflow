<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import DocumentTree from "../components/DocumentTree.vue";
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

const documents = ref<DocumentSummary[]>([]);
const docTypes = ref<DocType[]>([]);
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
    if (isRecentMode.value) {
      // 홈 대시보드 "더보기" - 변경 순 전체를 보여준다(트리 없이 단순
      // 목록 - 폴더 트리는 일반 문서 탭에서만).
      documents.value = await apiCall<DocumentSummary[]>(`/projects/${props.id}/documents/recent?limit=100`);
    }
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
</script>

<template>
  <div class="layout">
    <h2 v-if="isRecentMode" class="recent-heading">최근 변경된 문서(변경 순)</h2>
    <ul v-if="isRecentMode" class="list">
      <li v-for="doc in documents" :key="doc.trackingCode">
        <router-link :to="`/projects/${id}/documents/${doc.trackingCode}`">
          <code>{{ doc.trackingCode }}</code> {{ doc.title }}
        </router-link>
        <span class="right">
          <span class="muted">{{ docTypeLabel(doc.docTypeId) }} · {{ doc.statusCode }}</span>
        </span>
      </li>
      <li v-if="documents.length === 0" class="muted">문서가 없습니다.</li>
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

      <DocumentTree :project-id="id" />
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
