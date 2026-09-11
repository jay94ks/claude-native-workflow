<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";

const props = defineProps<{ projectId: string }>();
const route = useRoute();
const router = useRouter();

interface DocType {
  id: string;
  code: string;
  label: string;
  guideline: string | null;
}
interface DocumentSummary {
  trackingCode: string;
  title: string;
  docTypeId: string;
}
interface DocumentPage {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// 프로젝트 전체 문서를 한 번에 불러오던 것에서, 서버 페이지네이션
// (/documents/page - DocumentsView.vue가 이미 쓰는 라우트)을 재사용한
// 무한 스크롤로 바꿨다 - 문서가 많은 프로젝트에서 사이드바 하나가
// 브라우저 부담이 되는 걸 막는다.
const PAGE_SIZE = 30;

const docTypes = ref<DocType[]>([]);
const documents = ref<DocumentSummary[]>([]);
const activeDocTypeId = ref("");
const page = ref(1);
const totalPages = ref(1);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");
const sentinelRef = ref<HTMLDivElement>();

const newTitle = ref("");
const newTypeCode = ref("");
const creating = ref(false);

// AppLayout.vue 사이드바에 있어 ProjectShellView의 provide("projectMyRole")
// 트리 밖이라 여기서 직접 한 번 더 받는다(가벼운 요청 - 이 앱 규모에서
// 무시 가능한 중복).
const canCreateDocument = ref(false);
async function loadMyRole() {
  try {
    const project = await apiCall<{ myRole: string | null }>(`/projects/${props.projectId}`);
    canCreateDocument.value = project.myRole === "owner" || project.myRole === "editor";
  } catch {
    canCreateDocument.value = false;
  }
}

let observer: IntersectionObserver | null = null;
let disconnect: (() => void) | null = null;

const activeTrackingCode = computed(() => (typeof route.params.trackingCode === "string" ? route.params.trackingCode : null));
const selectedTypeGuideline = computed(() => docTypes.value.find((t) => t.code === newTypeCode.value)?.guideline ?? null);

function docTypeCode(id: string): string {
  return docTypes.value.find((t) => t.id === id)?.code ?? "?";
}

async function loadDocTypes() {
  try {
    docTypes.value = await apiCall<DocType[]>(`/projects/${props.projectId}/doc-types`);
  } catch {
    docTypes.value = [];
  }
}

async function loadPage(reset: boolean) {
  if (reset) {
    page.value = 1;
    documents.value = [];
    loading.value = true;
  } else {
    loadingMore.value = true;
  }
  error.value = "";
  try {
    const qs = new URLSearchParams({ page: String(page.value), pageSize: String(PAGE_SIZE) });
    if (activeDocTypeId.value) qs.set("docTypeId", activeDocTypeId.value);
    const result = await apiCall<DocumentPage>(`/projects/${props.projectId}/documents/page?${qs}`);
    documents.value = reset ? result.items : [...documents.value, ...result.items];
    totalPages.value = result.totalPages;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value) return;
  if (page.value >= totalPages.value) return;
  page.value += 1;
  await loadPage(false);
}

async function submitCreate() {
  if (!newTitle.value.trim() || !newTypeCode.value) return;
  creating.value = true;
  error.value = "";
  try {
    const doc = await apiCall<{ trackingCode: string }>(`/projects/${props.projectId}/documents`, {
      method: "POST",
      body: JSON.stringify({ docTypeCode: newTypeCode.value, title: newTitle.value.trim(), body: "" }),
    });
    newTitle.value = "";
    await loadPage(true);
    router.push(`/projects/${props.projectId}/documents/${doc.trackingCode}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  } finally {
    creating.value = false;
  }
}

watch(activeDocTypeId, () => {
  if (activeDocTypeId.value) {
    const t = docTypes.value.find((dt) => dt.id === activeDocTypeId.value);
    if (t) newTypeCode.value = t.code;
  }
  loadPage(true);
});
watch(docTypes, (types) => {
  if (types.length > 0 && !newTypeCode.value) newTypeCode.value = types[0].code;
});

onMounted(async () => {
  await loadMyRole();
  await loadDocTypes();
  await loadPage(true);

  await nextTick();
  if (sentinelRef.value) {
    observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    observer.observe(sentinelRef.value);
  }

  disconnect = await connectProjectRealtime(props.projectId, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "document") loadPage(true);
    },
  });
});

onBeforeUnmount(() => {
  observer?.disconnect();
  disconnect?.();
});
</script>

<template>
  <div class="explorer">
    <div class="filter-row">
      <select v-model="activeDocTypeId">
        <option value="">전체</option>
        <option v-for="t in docTypes" :key="t.id" :value="t.id">{{ t.code }} · {{ t.label }}</option>
      </select>
    </div>
    <form v-if="canCreateDocument" class="create-row" @submit.prevent="submitCreate">
      <input v-model="newTitle" type="text" placeholder="새 문서 제목" />
      <select v-model="newTypeCode">
        <option v-for="t in docTypes" :key="t.id" :value="t.code">{{ t.code }}</option>
      </select>
      <button type="submit" :disabled="creating || !newTitle.trim()">+</button>
    </form>
    <p v-if="canCreateDocument && selectedTypeGuideline" class="guideline-hint">{{ selectedTypeGuideline }}</p>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="docs">
      <li v-for="d in documents" :key="d.trackingCode">
        <router-link
          :to="`/projects/${projectId}/documents/${d.trackingCode}`"
          :class="{ active: d.trackingCode === activeTrackingCode }"
        >
          <span v-if="!activeDocTypeId" class="type-chip">{{ docTypeCode(d.docTypeId) }}</span>
          {{ d.title }}
        </router-link>
      </li>
      <li v-if="documents.length === 0" class="muted">문서 없음</li>
    </ul>
    <div ref="sentinelRef" class="sentinel"></div>
    <p v-if="loadingMore" class="muted">더 불러오는 중...</p>
  </div>
</template>

<style scoped>
.explorer {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.filter-row {
  margin-bottom: 6px;
}
.filter-row select {
  width: 100%;
  padding: 5px 6px;
  border-radius: 4px;
  border: 1px solid #454668;
  background: #24253f;
  color: #fff;
  font-size: 12px;
}
.create-row {
  display: flex;
  gap: 4px;
  margin-bottom: 2px;
}
.create-row input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid #454668;
  background: #24253f;
  color: #fff;
  font-size: 12px;
}
.create-row select {
  width: 56px;
  flex-shrink: 0;
  padding: 4px 4px;
  border-radius: 4px;
  border: 1px solid #454668;
  background: #24253f;
  color: #fff;
  font-size: 11px;
}
.create-row button {
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 4px;
  border: none;
  background: #3454d1;
  color: #fff;
  flex-shrink: 0;
}
.create-row button:disabled {
  opacity: 0.5;
}
.guideline-hint {
  font-size: 11px;
  color: #8688a8;
  margin: 2px 0 8px;
}
.docs {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
}
.docs li a {
  display: block;
  padding: 5px 8px;
  border-radius: 6px;
  color: #c7c9e8;
  text-decoration: none;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.docs li a:hover {
  background: #2e2f4d;
  color: #fff;
}
.docs li a.active {
  background: #3454d1;
  color: #fff;
}
.type-chip {
  display: inline-block;
  font-size: 10px;
  color: #8688a8;
  background: #24253f;
  border-radius: 3px;
  padding: 1px 4px;
  margin-right: 4px;
}
.sentinel {
  height: 1px;
}
.muted {
  color: #8688a8;
  font-size: 12px;
  padding: 2px 8px;
}
.error {
  color: #ff8a9b;
  font-size: 12px;
}
</style>
