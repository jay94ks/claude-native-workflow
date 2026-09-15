<script setup lang="ts">
import StatusBadge from "./StatusBadge.vue";
// "문서" 탭의 폴더/문서 분류/리스트 서브탭이 공유하는 우측 문서
// 목록(#documents-tab-redesign) - 데이터 소스(폴더별/분류별/전체)는
// 다르지만 렌더링·페이지네이션·클릭 시 문서 보기 이동은 항상 동일해서
// 이 컴포넌트 하나로 통일한다. fetch는 부모가 하고, 이 컴포넌트는
// 결과만 받아 보여주는 순수 표시용.
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
}

const props = defineProps<{
  projectId: string;
  items: DocumentSummary[];
  docTypes: DocType[];
  page: number;
  totalPages: number;
  total: number;
  loading: boolean;
  error: string;
}>();
const emit = defineEmits<{ "page-change": [page: number] }>();

function docTypeLabel(id: string): string {
  const t = props.docTypes.find((dt) => dt.id === id);
  return t ? `${t.code} · ${t.label}` : id;
}
</script>

<template>
  <div class="panel">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <template v-else>
      <ul class="list">
        <li v-for="doc in items" :key="doc.trackingCode">
          <router-link :to="`/projects/${projectId}/documents/${doc.trackingCode}`">
            <code>{{ doc.trackingCode }}</code> {{ doc.title }}
          </router-link>
          <span class="right">
            <span class="muted">{{ docTypeLabel(doc.docTypeId) }}</span>
            <StatusBadge :code="doc.statusCode" />
          </span>
        </li>
        <li v-if="items.length === 0" class="muted empty">문서가 없습니다.</li>
      </ul>
      <div v-if="totalPages > 1" class="pagination">
        <button type="button" :disabled="page <= 1" @click="emit('page-change', page - 1)">이전</button>
        <span class="page-indicator">{{ page }} / {{ totalPages }} (총 {{ total }}건)</span>
        <button type="button" :disabled="page >= totalPages" @click="emit('page-change', page + 1)">다음</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  flex: 1;
  min-width: 0;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
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
  gap: 12px;
}
.list li:last-child {
  border-bottom: none;
}
.list a {
  color: var(--color-text);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list a:hover {
  color: var(--color-primary);
}
.list code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 6px;
}
.list .empty {
  padding: 12px 16px;
}
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}
.pagination button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.pagination button:disabled {
  opacity: 0.4;
}
.page-indicator {
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
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
