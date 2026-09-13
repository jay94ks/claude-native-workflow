<script setup lang="ts">
// 관계도 우측 상세 패널 - RelationsView.vue에 인라인으로 있던
// <aside class="sidebar"> 블록을 그대로 옮긴 것(#relations-graph-redesign,
// 그래프 캔버스 엔진 교체와 무관하게 필드/동작 전부 동일하게 유지).
// 실제 API 호출/상태는 전부 부모(RelationsView.vue)가 그대로 소유하고,
// 이 컴포넌트는 의도만 emit한다.
import { ref } from "vue";
import TrackingCodeText from "./TrackingCodeText.vue";

interface CodeRelationDetail {
  id: string;
  createdAt: string;
  updatedAt: string;
  target: string;
  referrer: string;
  purpose: string;
  filePath: string;
  line: number | null;
  column: number | null;
  data: unknown;
  branchName: string | null;
  trackingCodes: string[];
  tags: string[];
  parentIds: string[];
  childIds: string[];
}

defineProps<{
  detail: CodeRelationDetail | null;
  depth: number;
  linkError: string;
}>();
const emit = defineEmits<{
  edit: [detail: CodeRelationDetail];
  delete: [];
  "expand-parents": [];
  "expand-children": [];
  "link-as-parent": [id: string];
  "link-as-child": [id: string];
}>();

const linkParentInput = ref("");
const linkChildInput = ref("");

function submitLinkParent() {
  if (!linkParentInput.value.trim()) return;
  emit("link-as-parent", linkParentInput.value.trim());
  linkParentInput.value = "";
}
function submitLinkChild() {
  if (!linkChildInput.value.trim()) return;
  emit("link-as-child", linkChildInput.value.trim());
  linkChildInput.value = "";
}
</script>

<template>
  <aside class="sidebar">
    <template v-if="detail">
      <h3><TrackingCodeText :text="detail.target" /></h3>
      <dl>
        <dt>참조 주체</dt>
        <dd><TrackingCodeText :text="detail.referrer" /></dd>
        <dt>목적</dt>
        <dd><TrackingCodeText :text="detail.purpose" /></dd>
        <dt>파일</dt>
        <dd><code>{{ detail.filePath }}{{ detail.line ? `:${detail.line}` : "" }}{{ detail.column ? `:${detail.column}` : "" }}</code></dd>
        <dt>연관 문서</dt>
        <dd>
          <TrackingCodeText v-if="detail.trackingCodes.length" :text="detail.trackingCodes.join(', ')" />
          <span v-else class="muted">없음</span>
        </dd>
        <dt>태그</dt>
        <dd>
          <span v-for="t in detail.tags" :key="t" class="tag-chip">{{ t }}</span>
          <span v-if="detail.tags.length === 0" class="muted">없음</span>
        </dd>
        <dt>추가 데이터</dt>
        <dd><pre v-if="detail.data !== null && detail.data !== undefined" class="data-json">{{ JSON.stringify(detail.data, null, 2) }}</pre><span v-else class="muted">없음</span></dd>
        <dt>상위 관계</dt>
        <dd>{{ detail.parentIds.length }}개</dd>
        <dt>하위 관계</dt>
        <dd>{{ detail.childIds.length }}개</dd>
      </dl>

      <div class="button-row">
        <button type="button" @click="emit('edit', detail)">수정</button>
        <button type="button" class="danger" @click="emit('delete')">삭제</button>
      </div>

      <div class="expand-row">
        <button type="button" @click="emit('expand-parents')">상위 펼치기 depth={{ depth }}</button>
        <button type="button" @click="emit('expand-children')">하위 펼치기 depth={{ depth }}</button>
      </div>

      <div class="link-section">
        <p class="hint">이미 있는 다른 관계와 연결(id로 지정)</p>
        <div class="link-row">
          <input v-model="linkParentInput" type="text" placeholder="상위로 연결할 관계 id" />
          <button type="button" @click="submitLinkParent">연결</button>
        </div>
        <div class="link-row">
          <input v-model="linkChildInput" type="text" placeholder="하위로 연결할 관계 id" />
          <button type="button" @click="submitLinkChild">연결</button>
        </div>
        <p v-if="linkError" class="error">{{ linkError }}</p>
      </div>
    </template>
    <p v-else class="muted">그래프에서 노드를 클릭하면 상세 정보가 여기 표시됩니다. 더블클릭하면 하위 관계가 한 단계 펼쳐집니다.</p>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 320px;
  flex-shrink: 0;
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 14px;
  overflow-y: auto;
}
.sidebar h3 {
  font-size: 14px;
  margin: 0 0 10px;
  word-break: break-word;
}
.sidebar dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 10px;
  margin: 0 0 12px;
}
.sidebar dt {
  color: var(--color-text-faint);
  font-size: 11px;
}
.sidebar dd {
  margin: 0;
  font-size: 12px;
  word-break: break-word;
}
.tag-chip {
  display: inline-block;
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  margin: 0 4px 4px 0;
}
.data-json {
  background: var(--color-bg, var(--color-surface-hover));
  padding: 8px;
  border-radius: 6px;
  font-size: 11px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.button-row,
.expand-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.button-row button,
.expand-row button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.button-row button.danger {
  color: var(--color-danger);
  border-color: var(--color-danger);
}
.link-section {
  border-top: 1px solid var(--color-border-light);
  padding-top: 10px;
}
.link-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.link-row input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12px;
}
.link-row button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.hint {
  font-size: 11px;
  color: var(--color-text-faint);
  margin: 0 0 6px;
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
